// Command server runs the incident-agent demo: it serves the embedded
// browser frontend on a single port, the same free-tier-friendly shape used
// by the sibling sqllab/schemalab/routelab demos. The demo's alert/log/
// deploy/metric fixtures and the "paste your own data" parsing run in the
// browser; the LLM reasoning step is pluggable between three backends the
// visitor picks in the UI - a small WebLLM/WebGPU model running locally, a
// visitor-supplied Claude API key called directly from the browser, or
// this server's own rate-limited proxy (POST /api/investigate, wired up
// below) so visitors who don't want to get their own key can still see a
// real Claude-generated report.
package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"incident-agent/internal/agent"
	"incident-agent/internal/claude"
	"incident-agent/web"
)

const freeTierModel = "claude-haiku-4-5"

func serveJapanese(w http.ResponseWriter, r *http.Request) {
	http.ServeFileFS(w, r, web.Assets, "index.ja.html")
}

// envInt reads an integer env var, falling back to def if it's unset or
// unparseable.
func envInt(name string, def int) int {
	v := os.Getenv(name)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		log.Printf("invalid %s=%q, using default %d", name, v, def)
		return def
	}
	return n
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ja", serveJapanese)
	mux.HandleFunc("GET /ja/", serveJapanese)

	if apiKey := os.Getenv("ANTHROPIC_API_KEY"); apiKey != "" {
		claudeClient := claude.NewClient(apiKey, freeTierModel)
		if base := os.Getenv("ANTHROPIC_BASE_URL"); base != "" {
			claudeClient.BaseURL = base
		}
		inv := agent.NewInvestigator(claudeClient)
		inv.MaxTokens = 1200

		perIPLimit := envInt("FREE_TIER_MAX_PER_IP_PER_HOUR", 5)
		dailyLimit := envInt("FREE_TIER_MAX_PER_DAY", 200)
		limiter := newRateLimiter(perIPLimit, time.Hour, dailyLimit)

		mux.Handle("POST /api/investigate", investigateHandler(inv, limiter))
		log.Printf("free-tier Claude API proxy enabled (model=%s, %d/ip/hour, %d/day)", freeTierModel, perIPLimit, dailyLimit)
	} else {
		log.Printf("ANTHROPIC_API_KEY not set — free-tier Claude API proxy disabled; only WebLLM and bring-your-own-key will work in the demo")
	}

	mux.Handle("/", http.FileServer(http.FS(web.Assets)))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	log.Printf("incident-agent demo: serving on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("HTTP server died: %v", err)
	}
}

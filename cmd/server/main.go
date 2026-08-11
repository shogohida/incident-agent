// Command server runs the incident-agent demo: it serves the embedded
// browser frontend on a single port, the same free-tier-friendly shape used
// by the sibling sqllab/schemalab/routelab demos. There is no server-side
// investigation logic here — the demo's alert/log/deploy/metric fixtures
// and the LLM reasoning both run entirely in the browser (WebLLM/WebGPU),
// so this binary is a static file server.
package main

import (
	"log"
	"net/http"
	"os"

	"incident-agent/web"
)

func serveJapanese(w http.ResponseWriter, r *http.Request) {
	http.ServeFileFS(w, r, web.Assets, "index.ja.html")
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ja", serveJapanese)
	mux.HandleFunc("GET /ja/", serveJapanese)
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

package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"incident-agent/internal/agent"
	"incident-agent/internal/alert"
	"incident-agent/internal/sources"
)

// maxRequestBodyBytes bounds the size of a single free-tier request.
// Generous enough for a pasted incident's worth of logs, but it caps the
// worst case token (and therefore dollar) cost of one call regardless of
// what a client sends.
const maxRequestBodyBytes = 256 * 1024

// investigateRequest mirrors exactly what the browser demo's scenario
// fixtures and "paste your own data" feature already produce - same field
// names as alert.Alert and internal/sources, so the browser can send its
// already-gathered data as-is with no reshaping.
type investigateRequest struct {
	Alert        alert.Alert            `json:"alert"`
	Logs         []sources.LogEntry     `json:"logs"`
	Deploys      []sources.Deploy       `json:"deploys"`
	Metrics      []sources.MetricSeries `json:"metrics"`
	SourceErrors []string               `json:"sourceErrors"`
}

// investigateHandler is the "free tier" the browser demo calls when the
// visitor hasn't brought their own Claude API key: it runs the exact same
// internal/agent pipeline the CLI uses, against a key held only in this
// process's environment. limiter is what keeps that shared key's bill
// bounded.
func investigateHandler(inv *agent.Investigator, limiter *rateLimiter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if ok, reason := limiter.allow(ip); !ok {
			writeJSONError(w, http.StatusTooManyRequests, reason)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
		var req investigateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()

		report, err := inv.InvestigateContext(ctx, req.Alert, req.Logs, req.Deploys, req.Metrics, req.SourceErrors)
		if err != nil {
			log.Printf("free-tier investigate failed for %s: %v", ip, err)
			writeJSONError(w, http.StatusBadGateway, "investigation failed — try again, or use your own API key / the in-browser model")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(report)
	}
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

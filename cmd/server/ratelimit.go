package main

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// rateLimiter enforces a per-IP-per-window cap plus a global per-day cap,
// so the shared "free tier" Claude API key (paid for by whoever runs this
// demo) can't be run up into an unbounded bill by one abusive client or a
// traffic spike. In-memory and single-process is enough here - this is a
// low-traffic demo on Render's free tier, not a service that needs to
// survive restarts or scale horizontally.
type rateLimiter struct {
	perIPLimit  int
	perIPWindow time.Duration
	dailyLimit  int

	mu       sync.Mutex
	byIP     map[string][]time.Time
	dayStart time.Time
	dayCount int
}

func newRateLimiter(perIPLimit int, perIPWindow time.Duration, dailyLimit int) *rateLimiter {
	return &rateLimiter{
		perIPLimit:  perIPLimit,
		perIPWindow: perIPWindow,
		dailyLimit:  dailyLimit,
		byIP:        make(map[string][]time.Time),
		dayStart:    time.Now().UTC().Truncate(24 * time.Hour),
	}
}

// allow reports whether a request from ip may proceed, and if not, a
// human-readable reason suitable for returning straight to the client.
func (rl *rateLimiter) allow(ip string) (bool, string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now().UTC()
	if today := now.Truncate(24 * time.Hour); today.After(rl.dayStart) {
		rl.dayStart = today
		rl.dayCount = 0
		rl.byIP = make(map[string][]time.Time) // also bounds memory growth across days
	}

	if rl.dayCount >= rl.dailyLimit {
		return false, "the shared free-tier quota for today has been used up — try again tomorrow, or use your own API key / the in-browser model"
	}

	cutoff := now.Add(-rl.perIPWindow)
	kept := rl.byIP[ip][:0]
	for _, t := range rl.byIP[ip] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= rl.perIPLimit {
		rl.byIP[ip] = kept
		return false, "you've hit the free-tier rate limit for this hour — try again later, or use your own API key / the in-browser model"
	}

	rl.byIP[ip] = append(kept, now)
	rl.dayCount++
	return true, ""
}

// clientIP extracts the caller's address, preferring the first hop in
// X-Forwarded-For (Render, like most PaaS, sits in front of the app as a
// reverse proxy, so RemoteAddr alone would just be Render's edge).
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

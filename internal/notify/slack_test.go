package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"incident-agent/internal/agent"
	"incident-agent/internal/alert"
)

func sampleReport() *agent.Report {
	return &agent.Report{
		Alert:            alert.Alert{Service: "checkout", Title: "High error rate"},
		Summary:          "DB pool exhaustion likely.",
		AssessedSeverity: "critical",
		Confidence:       0.8,
		RootCauseHypotheses: []agent.Hypothesis{
			{Description: "connection pool exhausted", Confidence: 0.8, Evidence: []string{"log line X"}},
		},
		RecommendedActions: []string{"check pool metrics"},
		SuspiciousDeploys:  []string{"abc123"},
		SourceErrors:       []string{"metrics unavailable: timeout"},
	}
}

func TestSlackNotifierPostsExpectedPayload(t *testing.T) {
	var gotBody []byte
	var gotContentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotContentType = r.Header.Get("Content-Type")
		buf, _ := io.ReadAll(r.Body)
		gotBody = buf
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n := NewSlackNotifier(srv.URL)
	n.HTTP = srv.Client()

	if err := n.Notify(context.Background(), sampleReport()); err != nil {
		t.Fatalf("Notify failed: %v", err)
	}
	if gotContentType != "application/json" {
		t.Fatalf("content type = %q", gotContentType)
	}

	var payload slackPayload
	if err := json.Unmarshal(gotBody, &payload); err != nil {
		t.Fatalf("response body was not valid JSON: %v (%s)", err, gotBody)
	}
	if len(payload.Blocks) != 1 {
		t.Fatalf("expected 1 block, got %d", len(payload.Blocks))
	}
	text := payload.Blocks[0].Text.Text
	for _, want := range []string{"checkout", "High error rate", "connection pool exhausted", "check pool metrics", "abc123", "metrics unavailable"} {
		if !strings.Contains(text, want) {
			t.Fatalf("slack message missing %q:\n%s", want, text)
		}
	}
}

func TestSlackNotifierPropagatesHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	n := NewSlackNotifier(srv.URL)
	n.HTTP = srv.Client()

	err := n.Notify(context.Background(), sampleReport())
	if err == nil {
		t.Fatalf("expected an error on non-200 response")
	}
}

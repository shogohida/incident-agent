package agent

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"incident-agent/internal/alert"
	"incident-agent/internal/sources"
)

// fakeClaude lets tests control exactly what the "model" returns and
// inspect exactly what prompt it was given.
type fakeClaude struct {
	response   string
	err        error
	lastSystem string
	lastUser   string
	callCount  int
}

func (f *fakeClaude) Complete(ctx context.Context, systemPrompt, userMessage string, maxTokens int) (string, error) {
	f.callCount++
	f.lastSystem = systemPrompt
	f.lastUser = userMessage
	return f.response, f.err
}

type fakeLogSource struct {
	entries []sources.LogEntry
	err     error
}

func (f *fakeLogSource) FetchRecentLogs(ctx context.Context, service string, since time.Duration, limit int) ([]sources.LogEntry, error) {
	return f.entries, f.err
}

type fakeDeploySource struct {
	deploys []sources.Deploy
	err     error
}

func (f *fakeDeploySource) FetchRecentDeploys(ctx context.Context, service string, since time.Duration) ([]sources.Deploy, error) {
	return f.deploys, f.err
}

const validJSON = `{
  "summary": "Checkout service is failing due to a database connection pool exhaustion.",
  "assessed_severity": "critical",
  "confidence": 0.8,
  "root_cause_hypotheses": [
    {"description": "DB connection pool exhausted after recent deploy", "confidence": 0.8, "evidence": ["log line X", "commit abc123"]}
  ],
  "recommended_actions": ["Check connection pool metrics", "Consider rolling back commit abc123"],
  "suspicious_deploys": ["abc123"]
}`

func testAlert() alert.Alert {
	return alert.Alert{
		ID:       "alert-1",
		Service:  "checkout",
		Title:    "High error rate",
		Message:  "5xx rate above threshold",
		Severity: alert.SeverityCritical,
		FiredAt:  time.Now(),
	}
}

func TestInvestigateHappyPath(t *testing.T) {
	claude := &fakeClaude{response: validJSON}
	inv := NewInvestigator(claude)
	inv.Logs = &fakeLogSource{entries: []sources.LogEntry{
		{Timestamp: time.Now(), Level: "error", Service: "checkout", Message: "connection pool exhausted"},
	}}
	inv.Deploys = &fakeDeploySource{deploys: []sources.Deploy{
		{SHA: "abc123def", Author: "shogo", Message: "tweak pool size", Timestamp: time.Now()},
	}}

	report, err := inv.Investigate(context.Background(), testAlert())
	if err != nil {
		t.Fatalf("Investigate failed: %v", err)
	}
	if report.AssessedSeverity != "critical" {
		t.Fatalf("assessed severity = %q", report.AssessedSeverity)
	}
	if len(report.RootCauseHypotheses) != 1 {
		t.Fatalf("expected 1 hypothesis, got %d", len(report.RootCauseHypotheses))
	}
	if report.Confidence != 0.8 {
		t.Fatalf("confidence = %v", report.Confidence)
	}
	if len(report.SourceErrors) != 0 {
		t.Fatalf("expected no source errors, got %v", report.SourceErrors)
	}

	// the prompt actually sent to "Claude" should contain the gathered evidence
	if !strings.Contains(claude.lastUser, "connection pool exhausted") {
		t.Fatalf("prompt did not include log evidence:\n%s", claude.lastUser)
	}
	if !strings.Contains(claude.lastUser, "abc123de") {
		t.Fatalf("prompt did not include deploy evidence:\n%s", claude.lastUser)
	}
}

func TestInvestigateTolerateSourcePartialFailure(t *testing.T) {
	claude := &fakeClaude{response: validJSON}
	inv := NewInvestigator(claude)
	inv.Logs = &fakeLogSource{err: errors.New("log file locked")}
	inv.Deploys = &fakeDeploySource{deploys: []sources.Deploy{{SHA: "abc123def", Message: "ok"}}}

	report, err := inv.Investigate(context.Background(), testAlert())
	if err != nil {
		t.Fatalf("Investigate should not fail just because one source errored: %v", err)
	}
	if len(report.SourceErrors) != 1 {
		t.Fatalf("expected exactly 1 recorded source error, got %v", report.SourceErrors)
	}
	if !strings.Contains(report.SourceErrors[0], "log file locked") {
		t.Fatalf("source error should mention the underlying cause, got %q", report.SourceErrors[0])
	}
	// the model should still have been asked, with the gap flagged
	if !strings.Contains(claude.lastUser, "Context gathering issues") {
		t.Fatalf("prompt should surface source errors to the model:\n%s", claude.lastUser)
	}
}

func TestInvestigateAllSourcesFailStillCallsModel(t *testing.T) {
	claude := &fakeClaude{response: validJSON}
	inv := NewInvestigator(claude)
	inv.Logs = &fakeLogSource{err: errors.New("down")}
	inv.Deploys = &fakeDeploySource{err: errors.New("down")}

	report, err := inv.Investigate(context.Background(), testAlert())
	if err != nil {
		t.Fatalf("should still produce a (low-confidence-encouraged) report: %v", err)
	}
	if len(report.SourceErrors) != 2 {
		t.Fatalf("expected 2 source errors, got %d: %v", len(report.SourceErrors), report.SourceErrors)
	}
}

func TestInvestigateNoSourcesConfigured(t *testing.T) {
	claude := &fakeClaude{response: validJSON}
	inv := NewInvestigator(claude) // no Logs, no Deploys, no Metrics at all

	report, err := inv.Investigate(context.Background(), testAlert())
	if err != nil {
		t.Fatalf("should work with zero sources configured: %v", err)
	}
	if claude.callCount != 1 {
		t.Fatalf("expected exactly 1 call to claude, got %d", claude.callCount)
	}
	if len(report.SourceErrors) != 0 {
		t.Fatalf("no sources configured means no source errors, got %v", report.SourceErrors)
	}
}

func TestInvestigateClaudeErrorPropagates(t *testing.T) {
	claude := &fakeClaude{err: errors.New("api down")}
	inv := NewInvestigator(claude)

	_, err := inv.Investigate(context.Background(), testAlert())
	if err == nil {
		t.Fatalf("expected an error when the claude call fails")
	}
	if !strings.Contains(err.Error(), "api down") {
		t.Fatalf("error should wrap the underlying cause, got %v", err)
	}
}

func TestInvestigateHandlesMarkdownFencedResponse(t *testing.T) {
	fenced := "```json\n" + validJSON + "\n```"
	claude := &fakeClaude{response: fenced}
	inv := NewInvestigator(claude)

	report, err := inv.Investigate(context.Background(), testAlert())
	if err != nil {
		t.Fatalf("should tolerate a markdown-fenced response: %v", err)
	}
	if report.Summary == "" {
		t.Fatalf("expected a parsed summary")
	}
}

func TestInvestigateMalformedResponseReturnsError(t *testing.T) {
	claude := &fakeClaude{response: "not json at all"}
	inv := NewInvestigator(claude)

	_, err := inv.Investigate(context.Background(), testAlert())
	if err == nil {
		t.Fatalf("expected a parse error")
	}
}

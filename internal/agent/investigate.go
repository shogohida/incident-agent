// Package agent orchestrates an incident investigation: gather context from
// pluggable sources, ask Claude to reason over it, and return a structured
// report for a human on-call engineer to act on.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"incident-agent/internal/alert"
	"incident-agent/internal/sources"
)

// ClaudeClient is the narrow interface the agent needs from a Claude API
// client. Defining it here (rather than depending on the concrete
// internal/claude.Client type) is what makes Investigate unit-testable
// without any network access.
type ClaudeClient interface {
	Complete(ctx context.Context, systemPrompt, userMessage string, maxTokens int) (string, error)
}

type MetricRequest struct {
	Source sources.MetricSource
	Name   string
}

// Investigator holds the (optional) context sources and the Claude client
// used to reason over what they return. Every source field is optional -
// nil sources are simply skipped, so this works with zero, one, or all of
// logs/deploys/metrics configured.
type Investigator struct {
	Claude  ClaudeClient
	Logs    sources.LogSource
	Deploys sources.DeploySource
	Metrics []MetricRequest

	LookbackWindow   time.Duration // how far back to pull logs/deploys/metrics
	LogLimit         int
	MaxTokens        int
	PerSourceTimeout time.Duration
}

func NewInvestigator(claude ClaudeClient) *Investigator {
	return &Investigator{
		Claude:           claude,
		LookbackWindow:   30 * time.Minute,
		LogLimit:         200,
		MaxTokens:        1500,
		PerSourceTimeout: 10 * time.Second,
	}
}

type Hypothesis struct {
	Description string   `json:"description"`
	Confidence  float64  `json:"confidence"`
	Evidence    []string `json:"evidence"`
}

type Report struct {
	Alert               alert.Alert  `json:"alert"`
	GeneratedAt         time.Time    `json:"generated_at"`
	Summary             string       `json:"summary"`
	AssessedSeverity    string       `json:"assessed_severity"`
	Confidence          float64      `json:"confidence"`
	RootCauseHypotheses []Hypothesis `json:"root_cause_hypotheses"`
	RecommendedActions  []string     `json:"recommended_actions"`
	SuspiciousDeploys   []string     `json:"suspicious_deploys"`
	SourceErrors        []string     `json:"source_errors,omitempty"`
	RawModelOutput      string       `json:"-"` // kept for debugging, not serialized to clients
}

// modelResponse mirrors the JSON shape we instruct the model to produce
// (see systemPrompt in prompt.go).
type modelResponse struct {
	Summary             string       `json:"summary"`
	AssessedSeverity    string       `json:"assessed_severity"`
	Confidence          float64      `json:"confidence"`
	RootCauseHypotheses []Hypothesis `json:"root_cause_hypotheses"`
	RecommendedActions  []string     `json:"recommended_actions"`
	SuspiciousDeploys   []string     `json:"suspicious_deploys"`
}

// Investigate gathers available context (concurrently, tolerating partial
// failures) and asks Claude to produce a structured root-cause report.
func (inv *Investigator) Investigate(ctx context.Context, a alert.Alert) (*Report, error) {
	logs, deploys, metrics, sourceErrors := inv.gatherContext(ctx, a)

	userMessage := buildUserMessage(a, logs, deploys, metrics, sourceErrors)

	rawText, err := inv.Claude.Complete(ctx, systemPrompt, userMessage, inv.maxTokensOrDefault())
	if err != nil {
		return nil, fmt.Errorf("agent: claude request failed: %w", err)
	}

	parsed, err := parseModelResponse(rawText)
	if err != nil {
		return nil, fmt.Errorf("agent: could not parse model response: %w (raw output follows)\n%s", err, rawText)
	}

	return &Report{
		Alert:               a,
		GeneratedAt:         time.Now(),
		Summary:             parsed.Summary,
		AssessedSeverity:    parsed.AssessedSeverity,
		Confidence:          parsed.Confidence,
		RootCauseHypotheses: parsed.RootCauseHypotheses,
		RecommendedActions:  parsed.RecommendedActions,
		SuspiciousDeploys:   parsed.SuspiciousDeploys,
		SourceErrors:        sourceErrors,
		RawModelOutput:      rawText,
	}, nil
}

func (inv *Investigator) maxTokensOrDefault() int {
	if inv.MaxTokens > 0 {
		return inv.MaxTokens
	}
	return 1500
}

// gatherContext fetches from every configured source concurrently. A
// failure in one source (e.g. the log file is temporarily unreadable, or
// GitHub rate-limits us) does not abort the investigation - it's recorded
// as a source error and surfaced to the model so it can lower its
// confidence accordingly, which is more useful during an actual incident
// than the whole tool refusing to produce a report.
func (inv *Investigator) gatherContext(ctx context.Context, a alert.Alert) ([]sources.LogEntry, []sources.Deploy, []sources.MetricSeries, []string) {
	var (
		wg           sync.WaitGroup
		mu           sync.Mutex
		logs         []sources.LogEntry
		deploys      []sources.Deploy
		metricSeries []sources.MetricSeries
		errs         []string
	)

	recordErr := func(format string, args ...interface{}) {
		mu.Lock()
		errs = append(errs, fmt.Sprintf(format, args...))
		mu.Unlock()
	}

	if inv.Logs != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, inv.PerSourceTimeout)
			defer cancel()
			result, err := inv.Logs.FetchRecentLogs(cctx, a.Service, inv.LookbackWindow, inv.LogLimit)
			if err != nil {
				recordErr("log source unavailable: %v", err)
				return
			}
			mu.Lock()
			logs = result
			mu.Unlock()
		}()
	}

	if inv.Deploys != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, inv.PerSourceTimeout)
			defer cancel()
			result, err := inv.Deploys.FetchRecentDeploys(cctx, a.Service, inv.LookbackWindow)
			if err != nil {
				recordErr("deploy source unavailable: %v", err)
				return
			}
			mu.Lock()
			deploys = result
			mu.Unlock()
		}()
	}

	for _, mr := range inv.Metrics {
		mr := mr
		wg.Add(1)
		go func() {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, inv.PerSourceTimeout)
			defer cancel()
			result, err := mr.Source.FetchMetric(cctx, a.Service, mr.Name, inv.LookbackWindow)
			if err != nil {
				recordErr("metric %q unavailable: %v", mr.Name, err)
				return
			}
			mu.Lock()
			metricSeries = append(metricSeries, result)
			mu.Unlock()
		}()
	}

	wg.Wait()
	return logs, deploys, metricSeries, errs
}

// parseModelResponse tolerates the model wrapping its JSON in a markdown
// fence despite instructions not to, since that's a common enough deviation
// to be worth defending against rather than failing the whole report on it.
func parseModelResponse(raw string) (modelResponse, error) {
	text := strings.TrimSpace(raw)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)

	var parsed modelResponse
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return modelResponse{}, err
	}
	return parsed, nil
}

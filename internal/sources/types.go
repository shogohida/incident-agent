// Package sources defines the pluggable interfaces the investigation agent
// uses to gather context about an incident, plus a couple of concrete
// implementations. The point of the interface boundary is that swapping in
// a real observability backend (Datadog, CloudWatch Logs, Loki, Honeycomb)
// is "implement this interface", not "rewrite the agent".
package sources

import (
	"context"
	"time"
)

type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Service   string    `json:"service"`
	Message   string    `json:"message"`
}

type Deploy struct {
	SHA       string    `json:"sha"`
	Author    string    `json:"author"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
	URL       string    `json:"url"`
}

type MetricPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
}

type MetricSeries struct {
	Name   string        `json:"name"`
	Unit   string        `json:"unit"`
	Points []MetricPoint `json:"points"`
}

// LogSource fetches recent log lines for a service, up to `limit` entries,
// covering the window [now-since, now].
type LogSource interface {
	FetchRecentLogs(ctx context.Context, service string, since time.Duration, limit int) ([]LogEntry, error)
}

// DeploySource fetches recent deploys/merges for a service, so the agent can
// correlate "this alert fired 4 minutes after a deploy" - one of the single
// highest-signal facts in real incident investigation.
type DeploySource interface {
	FetchRecentDeploys(ctx context.Context, service string, since time.Duration) ([]Deploy, error)
}

// MetricSource fetches a named metric's recent time series for a service.
type MetricSource interface {
	FetchMetric(ctx context.Context, service, metricName string, since time.Duration) (MetricSeries, error)
}

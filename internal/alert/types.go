// Package alert defines the common shape an incoming alert is normalized
// into, regardless of which monitoring system triggered it (Datadog,
// CloudWatch, Prometheus Alertmanager, PagerDuty, ...). Adapters for each
// specific webhook payload live at the edge (cmd/investigator) and convert
// into this shape; everything downstream only ever deals with Alert.
package alert

import "time"

type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityWarning  Severity = "warning"
	SeverityInfo     Severity = "info"
)

// Alert is the normalized representation of "something is wrong" that
// triggers an investigation.
type Alert struct {
	ID         string            `json:"id"`
	Source     string            `json:"source"` // e.g. "datadog", "cloudwatch", "manual"
	Service    string            `json:"service"`
	Title      string            `json:"title"`
	Message    string            `json:"message"`
	Severity   Severity          `json:"severity"`
	Labels     map[string]string `json:"labels,omitempty"`
	FiredAt    time.Time         `json:"fired_at"`
	ReceivedAt time.Time         `json:"received_at"`
}

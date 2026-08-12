package agent

import (
	"fmt"
	"strings"

	"incident-agent/internal/alert"
	"incident-agent/internal/sources"
)

// SystemPrompt is exported so callers that reason over already-gathered
// context outside of Investigate (e.g. cmd/server's browser-demo proxy)
// can reuse the exact same prompt instead of duplicating it.
const SystemPrompt = `You are an experienced Site Reliability Engineer performing a first-pass
investigation of a production incident. You will be given the alert that
fired, plus whatever recent logs, deploy history, and metrics were
available to gather automatically.

Ground every hypothesis in the specific evidence provided. If the evidence
is thin or inconclusive, say so explicitly and lower your confidence rather
than guessing. Never invent log lines, commit SHAs, or metric values that
were not given to you.

You are producing an investigative report for a human on-call engineer, not
taking any action yourself - do not suggest running destructive commands
without a human confirming first, and do not claim to have "fixed" or
"rolled back" anything.

Respond with ONLY a single JSON object (no markdown fences, no commentary
before or after) matching exactly this shape:
{
  "summary": "one or two sentence plain-language summary of what's likely happening",
  "assessed_severity": "critical" | "warning" | "info",
  "confidence": 0.0-1.0,
  "root_cause_hypotheses": [
    {"description": "...", "confidence": 0.0-1.0, "evidence": ["...", "..."]}
  ],
  "recommended_actions": ["...", "..."],
  "suspicious_deploys": ["<sha or short description>", "..."]
}
List root_cause_hypotheses from most to least likely. If no deploys look
suspicious, return an empty array for suspicious_deploys rather than
omitting the field. recommended_actions must always contain at least one
concrete next step, even if it is only to gather more evidence.`

// buildUserMessage renders the gathered incident context into the text the
// model will reason over. Kept as a pure function (no I/O) so prompt
// formatting is unit-testable on its own.
func buildUserMessage(a alert.Alert, logs []sources.LogEntry, deploys []sources.Deploy, metrics []sources.MetricSeries, sourceErrors []string) string {
	var b strings.Builder

	fmt.Fprintf(&b, "## Alert\n")
	fmt.Fprintf(&b, "- Service: %s\n", a.Service)
	fmt.Fprintf(&b, "- Title: %s\n", a.Title)
	fmt.Fprintf(&b, "- Message: %s\n", a.Message)
	fmt.Fprintf(&b, "- Reported severity: %s\n", a.Severity)
	fmt.Fprintf(&b, "- Fired at: %s\n", a.FiredAt.Format("2006-01-02 15:04:05 MST"))
	if len(a.Labels) > 0 {
		fmt.Fprintf(&b, "- Labels: %v\n", a.Labels)
	}

	fmt.Fprintf(&b, "\n## Recent logs (%d entries, most recent first)\n", len(logs))
	if len(logs) == 0 {
		b.WriteString("(none available)\n")
	}
	for _, l := range logs {
		fmt.Fprintf(&b, "[%s] %s %s: %s\n", l.Timestamp.Format("15:04:05"), strings.ToUpper(l.Level), l.Service, l.Message)
	}

	fmt.Fprintf(&b, "\n## Recent deploys/commits (%d)\n", len(deploys))
	if len(deploys) == 0 {
		b.WriteString("(none available)\n")
	}
	for _, d := range deploys {
		sha := d.SHA
		if len(sha) > 8 {
			sha = sha[:8]
		}
		fmt.Fprintf(&b, "- %s by %s at %s: %s\n", sha, d.Author, d.Timestamp.Format("15:04:05"), d.Message)
	}

	if len(metrics) > 0 {
		fmt.Fprintf(&b, "\n## Metrics\n")
		for _, m := range metrics {
			fmt.Fprintf(&b, "- %s (%s), %d points:", m.Name, m.Unit, len(m.Points))
			for _, p := range m.Points {
				fmt.Fprintf(&b, " [%s=%.2f]", p.Timestamp.Format("15:04:05"), p.Value)
			}
			b.WriteString("\n")
		}
	}

	if len(sourceErrors) > 0 {
		fmt.Fprintf(&b, "\n## Context gathering issues (be more conservative in your confidence given these gaps)\n")
		for _, e := range sourceErrors {
			fmt.Fprintf(&b, "- %s\n", e)
		}
	}

	return b.String()
}

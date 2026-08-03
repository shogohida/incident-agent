package notify

import (
	"context"
	"fmt"
	"io"
	"strings"

	"incident-agent/internal/agent"
)

// ConsoleNotifier prints a human-readable report to any io.Writer (normally
// os.Stdout). Useful for local development/demos and for the CLI's one-shot
// "investigate" command when no Slack webhook is configured.
type ConsoleNotifier struct {
	Out io.Writer
}

func NewConsoleNotifier(out io.Writer) *ConsoleNotifier {
	return &ConsoleNotifier{Out: out}
}

func (c *ConsoleNotifier) Notify(ctx context.Context, r *agent.Report) error {
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n", strings.Repeat("=", 70))
	fmt.Fprintf(&b, "INCIDENT REPORT: %s — %s\n", r.Alert.Service, r.Alert.Title)
	fmt.Fprintf(&b, "Assessed severity: %s (confidence %.0f%%)\n", r.AssessedSeverity, r.Confidence*100)
	fmt.Fprintf(&b, "%s\n\n", strings.Repeat("-", 70))
	fmt.Fprintf(&b, "%s\n\n", r.Summary)

	if len(r.RootCauseHypotheses) > 0 {
		b.WriteString("Root cause hypotheses:\n")
		for i, h := range r.RootCauseHypotheses {
			fmt.Fprintf(&b, "  %d. [%.0f%%] %s\n", i+1, h.Confidence*100, h.Description)
			for _, e := range h.Evidence {
				fmt.Fprintf(&b, "       evidence: %s\n", e)
			}
		}
		b.WriteString("\n")
	}

	if len(r.RecommendedActions) > 0 {
		b.WriteString("Recommended actions:\n")
		for _, a := range r.RecommendedActions {
			fmt.Fprintf(&b, "  - %s\n", a)
		}
		b.WriteString("\n")
	}

	if len(r.SuspiciousDeploys) > 0 {
		fmt.Fprintf(&b, "Suspicious deploys: %s\n\n", strings.Join(r.SuspiciousDeploys, ", "))
	}

	if len(r.SourceErrors) > 0 {
		b.WriteString("Context gathering issues:\n")
		for _, e := range r.SourceErrors {
			fmt.Fprintf(&b, "  - %s\n", e)
		}
	}
	fmt.Fprintf(&b, "%s\n", strings.Repeat("=", 70))

	_, err := fmt.Fprint(c.Out, b.String())
	return err
}

// Package notify delivers a finished investigation report to a human,
// currently via Slack incoming webhook or the console. Both implement the
// same Notifier interface so cmd/investigator can pick one at startup.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"incident-agent/internal/agent"
)

type Notifier interface {
	Notify(ctx context.Context, report *agent.Report) error
}

// SlackNotifier posts to a Slack incoming webhook URL
// (https://api.slack.com/messaging/webhooks). It intentionally uses plain
// `blocks` JSON rather than a Slack SDK, again to keep this dependency-free.
type SlackNotifier struct {
	WebhookURL string
	HTTP       *http.Client
}

func NewSlackNotifier(webhookURL string) *SlackNotifier {
	return &SlackNotifier{WebhookURL: webhookURL, HTTP: &http.Client{Timeout: 10 * time.Second}}
}

type slackPayload struct {
	Blocks []slackBlock `json:"blocks"`
}

type slackBlock struct {
	Type string     `json:"type"`
	Text *slackText `json:"text,omitempty"`
}

type slackText struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func severityEmoji(sev string) string {
	switch sev {
	case "critical":
		return "🔴"
	case "warning":
		return "🟡"
	default:
		return "ℹ️"
	}
}

func (s *SlackNotifier) Notify(ctx context.Context, report *agent.Report) error {
	payload := buildSlackPayload(report)
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("slack notify: marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("slack notify: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := s.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("slack notify: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("slack notify: unexpected status %d", resp.StatusCode)
	}
	return nil
}

func buildSlackPayload(r *agent.Report) slackPayload {
	var b strings.Builder
	fmt.Fprintf(&b, "%s *%s* — %s\n", severityEmoji(r.AssessedSeverity), r.Alert.Service, r.Alert.Title)
	fmt.Fprintf(&b, "%s\n\n", r.Summary)
	fmt.Fprintf(&b, "*Confidence:* %.0f%%\n", r.Confidence*100)

	if len(r.RootCauseHypotheses) > 0 {
		b.WriteString("\n*Root cause hypotheses:*\n")
		for i, h := range r.RootCauseHypotheses {
			fmt.Fprintf(&b, "%d. %s _(confidence %.0f%%)_\n", i+1, h.Description, h.Confidence*100)
			for _, e := range h.Evidence {
				fmt.Fprintf(&b, "   - %s\n", e)
			}
		}
	}

	if len(r.RecommendedActions) > 0 {
		b.WriteString("\n*Recommended next steps:*\n")
		for _, a := range r.RecommendedActions {
			fmt.Fprintf(&b, "- %s\n", a)
		}
	}

	if len(r.SuspiciousDeploys) > 0 {
		fmt.Fprintf(&b, "\n*Suspicious deploys:* %s\n", strings.Join(r.SuspiciousDeploys, ", "))
	}

	if len(r.SourceErrors) > 0 {
		fmt.Fprintf(&b, "\n_Note: investigation had incomplete data (%s) - treat confidence accordingly._\n", strings.Join(r.SourceErrors, "; "))
	}

	return slackPayload{Blocks: []slackBlock{
		{Type: "section", Text: &slackText{Type: "mrkdwn", Text: b.String()}},
	}}
}

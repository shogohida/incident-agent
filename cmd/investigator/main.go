// Command investigator runs the incident investigation agent, either as a
// one-shot CLI ("investigate") or as an HTTP server that accepts alert
// webhooks and investigates them automatically ("serve").
//
// One-shot example:
//
//	export ANTHROPIC_API_KEY=sk-ant-...
//	./investigator investigate -service checkout -title "High error rate" \
//	    -message "5xx rate above threshold" -severity critical \
//	    -logs ./testdata/sample.log -github-owner myorg -github-repo myrepo
//
// Server example (point your monitoring tool's webhook at POST /alert):
//
//	./investigator serve -addr :8080 -slack-webhook https://hooks.slack.com/services/... \
//	    -logs /var/log/app/checkout.ndjson -github-owner myorg -github-repo myrepo
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"incident-agent/internal/agent"
	"incident-agent/internal/alert"
	"incident-agent/internal/claude"
	"incident-agent/internal/notify"
	"incident-agent/internal/sources"
)

func buildInvestigator(model, logPath, githubOwner, githubRepo, githubToken string) (*agent.Investigator, error) {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("ANTHROPIC_API_KEY environment variable is not set")
	}
	if model == "" {
		model = "claude-sonnet-4-6"
	}

	claudeClient := claude.NewClient(apiKey, model)
	if base := os.Getenv("ANTHROPIC_BASE_URL"); base != "" {
		claudeClient.BaseURL = base
	}
	inv := agent.NewInvestigator(claudeClient)

	if logPath != "" {
		inv.Logs = sources.NewFileLogSource(logPath)
	}
	if githubOwner != "" && githubRepo != "" {
		inv.Deploys = sources.NewGitHubDeploySource(githubOwner, githubRepo, githubToken)
	}
	return inv, nil
}

func runInvestigate(args []string) error {
	fs := flag.NewFlagSet("investigate", flag.ExitOnError)
	service := fs.String("service", "", "service name the alert is about (required)")
	title := fs.String("title", "", "short alert title (required)")
	message := fs.String("message", "", "alert message/detail")
	severity := fs.String("severity", "warning", "critical|warning|info")
	logPath := fs.String("logs", "", "path to an ndjson log file to search for context")
	githubOwner := fs.String("github-owner", "", "GitHub org/user, for correlating recent commits")
	githubRepo := fs.String("github-repo", "", "GitHub repo name, for correlating recent commits")
	githubToken := fs.String("github-token", os.Getenv("GITHUB_TOKEN"), "optional GitHub token (raises API rate limit)")
	slackWebhook := fs.String("slack-webhook", "", "optional Slack incoming webhook URL to also post the report to")
	model := fs.String("model", "", "Claude model to use (default claude-sonnet-4-6)")
	lookback := fs.Duration("lookback", 30*time.Minute, "how far back to search logs/deploys")
	fs.Parse(args)

	if *service == "" || *title == "" {
		return fmt.Errorf("-service and -title are required")
	}

	inv, err := buildInvestigator(*model, *logPath, *githubOwner, *githubRepo, *githubToken)
	if err != nil {
		return err
	}
	inv.LookbackWindow = *lookback

	a := alert.Alert{
		ID:         fmt.Sprintf("manual-%d", time.Now().UnixNano()),
		Source:     "manual",
		Service:    *service,
		Title:      *title,
		Message:    *message,
		Severity:   alert.Severity(*severity),
		FiredAt:    time.Now(),
		ReceivedAt: time.Now(),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	report, err := inv.Investigate(ctx, a)
	if err != nil {
		return fmt.Errorf("investigation failed: %w", err)
	}

	console := notify.NewConsoleNotifier(os.Stdout)
	if err := console.Notify(ctx, report); err != nil {
		return err
	}

	if *slackWebhook != "" {
		slack := notify.NewSlackNotifier(*slackWebhook)
		if err := slack.Notify(ctx, report); err != nil {
			log.Printf("warning: failed to post report to Slack: %v", err)
		}
	}
	return nil
}

func runServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", ":8080", "address to listen on for alert webhooks")
	logPath := fs.String("logs", "", "path to an ndjson log file to search for context")
	githubOwner := fs.String("github-owner", "", "GitHub org/user, for correlating recent commits")
	githubRepo := fs.String("github-repo", "", "GitHub repo name, for correlating recent commits")
	githubToken := fs.String("github-token", os.Getenv("GITHUB_TOKEN"), "optional GitHub token")
	slackWebhook := fs.String("slack-webhook", "", "Slack incoming webhook URL to post reports to")
	model := fs.String("model", "", "Claude model to use (default claude-sonnet-4-6)")
	fs.Parse(args)

	inv, err := buildInvestigator(*model, *logPath, *githubOwner, *githubRepo, *githubToken)
	if err != nil {
		return err
	}

	var notifier notify.Notifier = notify.NewConsoleNotifier(os.Stdout)
	if *slackWebhook != "" {
		notifier = notify.NewSlackNotifier(*slackWebhook)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/alert", func(w http.ResponseWriter, r *http.Request) {
		var a alert.Alert
		if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
			http.Error(w, fmt.Sprintf("invalid alert payload: %v", err), http.StatusBadRequest)
			return
		}
		if a.ID == "" {
			a.ID = fmt.Sprintf("webhook-%d", time.Now().UnixNano())
		}
		a.ReceivedAt = time.Now()
		if a.FiredAt.IsZero() {
			a.FiredAt = a.ReceivedAt
		}

		// Investigate asynchronously: the monitoring system's webhook call
		// should return fast, and a multi-second Claude round trip
		// shouldn't be on that critical path or risk the webhook timing out
		// and retrying (which would trigger a duplicate investigation).
		go func(a alert.Alert) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			report, err := inv.Investigate(ctx, a)
			if err != nil {
				log.Printf("investigation of alert %s failed: %v", a.ID, err)
				return
			}
			if err := notifier.Notify(ctx, report); err != nil {
				log.Printf("failed to deliver report for alert %s: %v", a.ID, err)
			}
		}(a)

		w.WriteHeader(http.StatusAccepted)
		fmt.Fprintf(w, `{"status":"investigating","alert_id":"%s"}`, a.ID)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	log.Printf("listening on %s (POST alerts to /alert)", *addr)
	return http.ListenAndServe(*addr, mux)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: investigator <investigate|serve> [flags]")
		os.Exit(1)
	}

	var err error
	switch os.Args[1] {
	case "investigate":
		err = runInvestigate(os.Args[2:])
	case "serve":
		err = runServe(os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q (want investigate|serve)\n", os.Args[1])
		os.Exit(1)
	}

	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

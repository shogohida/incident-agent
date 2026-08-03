# incident-agent

An LLM-powered incident investigation agent: when an alert fires, it
gathers recent logs, deploy history, and metrics, hands them to Claude, and
produces a structured root-cause report for the on-call engineer — in
seconds, before a human has even opened a dashboard.

This generalizes a system I built and ran in production at Zeroboard Inc.
(Claude-driven automated bug investigation and alert analysis, cutting mean
time to diagnosis by ~50%), rewritten from scratch as a standalone,
dependency-free, open-source tool.

```
incident-agent/
├── internal/claude    minimal Anthropic Messages API client (no SDK)
├── internal/alert     normalized alert shape (source-agnostic)
├── internal/sources   pluggable log / deploy / metric providers
├── internal/agent     orchestration: gather context → prompt → parse report
├── internal/notify    Slack webhook + console report delivery
└── cmd/investigator   CLI: one-shot `investigate` + webhook `serve` mode
```

## Quickstart

```bash
go build -o investigator ./cmd/investigator
export ANTHROPIC_API_KEY=sk-ant-...

# One-shot: investigate a specific incident right now
./investigator investigate \
  -service checkout -title "High 5xx error rate" \
  -message "Error rate exceeded 5% for 3 minutes" -severity critical \
  -logs ./testdata/sample.log \
  -github-owner myorg -github-repo myrepo

# Server mode: point your monitoring tool's webhook at /alert
./investigator serve -addr :8080 \
  -logs /var/log/app/checkout.ndjson \
  -github-owner myorg -github-repo myrepo \
  -slack-webhook https://hooks.slack.com/services/...
```

Any alerting system that can fire a webhook (Datadog, Alertmanager,
CloudWatch Alarms via SNS→Lambda, PagerDuty) can be pointed at `POST
/alert` with a JSON body matching `internal/alert.Alert`; write a ~10-line
adapter if the payload shape differs (see `cmd/investigator/main.go`).

## Running the tests

```bash
go test ./... -v
go test ./... -race
```

Every package is tested without any real network access or API key:
`internal/claude` and `internal/sources/github_deploys.go` are tested
against `httptest` mock servers; `internal/agent` is tested with a fake
`ClaudeClient` and fake sources so prompt construction and partial-failure
handling are verified deterministically.

## Design decisions

**Context gathering tolerates partial failure.** If the log source times
out or GitHub rate-limits the request, the investigation still proceeds —
the gap is recorded and explicitly surfaced to the model ("be more
conservative in your confidence given these gaps") rather than the whole
tool refusing to produce a report. During a real incident, a degraded
report immediately is far more useful than a perfect report that never
arrives because one dependency hiccupped.

**The agent investigates; it does not act.** There is no code path from a
model's output to an executed remediation (no auto-rollback, no auto-scale,
no restart). The system prompt explicitly instructs the model not to claim
to have fixed or rolled back anything. This is a deliberate scope boundary,
not a missing feature: giving an LLM direct write access to production
based on its own root-cause guess is a different (and much riskier) system
than the one this project is. A human stays in the loop for every action.

**Structured JSON output, strictly parsed.** The system prompt specifies an
exact JSON shape; `parseModelResponse` tolerates the common deviation of a
markdown code fence around it, but otherwise a malformed response is
surfaced as an error (with the raw text attached) rather than silently
guessed at. A wrong-shaped "insight" that renders wrong or crashes the
Slack formatter is worse than a visible parse failure.

**Deploy correlation via GitHub commits, not a deploy-tool integration.**
For teams doing trunk-based development with deploy-on-merge — the author's
own team's model — recent commits to `main` *are* a strong, genuinely
useful proxy for "what changed right before this fired," and needs zero
credentials against a public repo. `DeploySource` is an interface, so a team
with a real deploy pipeline (e.g. Zeroboard is not a public repo — Datadog
Deployment Tracking, Argo CD, Spinnaker) implements the same interface
without touching the agent.

**Alerts are investigated asynchronously in server mode.** The webhook
handler acks in milliseconds and runs the (multi-second, network-bound)
investigation in a goroutine. This avoids the alerting system's webhook
timing out and retrying — which would otherwise trigger duplicate
investigations for the same alert.

**Zero dependencies.** Like the companion `raftkv` project, this uses only
the Go standard library — no Anthropic SDK, no Slack SDK. For a project
this size, a ~150-line hand-rolled HTTP client is easier to audit end to
end than a dependency whose retry/auth/parsing behavior lives elsewhere.

## Known limitations / roadmap

- **Reads are not cached** — a burst of duplicate alerts for the same
  incident triggers separate investigations; a dedup window keyed on
  `(service, alert title)` would be a natural next step.
- **No feedback loop** — there's no mechanism yet for an engineer to mark a
  report "correct" or "wrong," which is what you'd want before trusting
  confidence scores at face value over time.
- **Metrics source is a static/seedable stub** — real Datadog/CloudWatch/
  Prometheus clients are a drop-in `MetricSource` implementation away, but
  aren't included here to keep the OSS project runnable without cloud
  credentials.
- **No conversation memory across investigations** — each alert is
  investigated independently; correlating "this is the third checkout
  incident this week" is not yet implemented.

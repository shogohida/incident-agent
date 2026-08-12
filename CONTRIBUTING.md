# Contributing

Thanks for taking a look at incident-agent. This is a small, dependency-free
Go project, so contributing should be low-friction.

## Getting set up

```bash
git clone https://github.com/shogohida/incident-agent.git
cd incident-agent
go build ./...
go test ./...
```

No external services are required to build or run the test suite — it's
pure Go with fakes for the Claude client and context sources (see
`internal/agent/investigate_test.go`). You only need `ANTHROPIC_API_KEY` (or
a local Ollama install) to actually run an investigation.

## Before opening a PR

- `go build ./...`, `go vet ./...`, and `go test ./...` should all pass
  (CI runs these on every PR).
- `gofmt -l .` should print nothing — run `gofmt -w .` if it does.
- If you touch the system prompt or the report JSON shape in
  `internal/agent/prompt.go`, please also update the line-for-line copies in
  `web/app.js` and `web/app.ja.js` (the browser demo intentionally mirrors
  the real prompt) and mention it in the PR description.
- Keep the zero-dependency philosophy in mind (see "Design decisions" in the
  README) — a new `go.sum` entry for something the standard library already
  covers is a hard sell here.

## Reporting bugs / proposing features

Open a GitHub issue. For anything nontrivial, a quick issue describing the
problem before a PR saves everyone a rewrite.

## Security issues

Please don't open a public issue for a security vulnerability — see
[SECURITY.md](SECURITY.md).

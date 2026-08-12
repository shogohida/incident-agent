# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability.

Instead, use GitHub's private reporting: go to the
[Security tab](https://github.com/shogohida/incident-agent/security/advisories/new)
of this repository and open a new draft security advisory. That notifies the
maintainer privately without exposing the issue to the public before a fix
is available.

If you'd rather not use GitHub, email shogo.hida@gmail.com with details.

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal example is ideal)
- Any relevant logs or output (with secrets redacted)

## Scope notes specific to this project

- **API keys** (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, Slack webhook URLs) are
  read from environment variables and never written to logs or committed to
  the repo. If you find a code path that leaks one, that's a P0.
- The live demo's server-side "free tier" proxy (`cmd/server`,
  `POST /api/investigate`) holds a real Anthropic API key. Reports of ways
  to bypass its rate limiting or make it emit more than a normal
  investigation's worth of tokens per request are in scope.
- The browser demo's "bring your own key" mode sends the visitor's Claude
  API key directly from their browser to `api.anthropic.com` and stores it
  only in that browser's `localStorage` — it is never sent to this project's
  server. Reports of any code path that sends it elsewhere are in scope.

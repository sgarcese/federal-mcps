# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**, not in a public issue.

Use GitHub's private reporting: on this repository, go to **Security → Advisories →
Report a vulnerability** ([open the form](https://github.com/sgarcese/federal-mcps/security/advisories/new)).
That opens a private channel with the maintainers.

Please include enough to reproduce: affected component, version/commit, steps, and impact.
We aim to acknowledge within a few days. Because this is a small open-source project,
please allow reasonable time to remediate before any public disclosure.

Describe the class of problem rather than including a working exploit or a step-by-step
extraction path.

## What's in scope

- The MCP servers in `packages/server-*` and the shared `packages/core`.
- The deployed endpoints (`bls-mcp.responsive.city`, `geo-mcp.responsive.city`).
- The build and deploy tooling in `scripts/` and `terraform/`.

## What to know about the threat model

- **The servers are read-only.** Every tool is annotated `readOnlyHint: true`; the
  servers only read published federal statistics and never write or mutate anything.
- **The data is public and there is no user authentication.** These endpoints serve
  open government data; there are no user accounts, sessions, or personal data.
- **Secrets never enter the repository.** API keys live in a local `.env` (gitignored)
  or as deployment/CI secrets, never in tracked files. `gitleaks` runs in CI on every
  change. If you believe a secret has been committed, treat it as a vulnerability and
  report it privately as above.
- **Upstream quotas are respected** through the shared HTTP client; please don't use a
  reported issue as cover for load-testing the public endpoints.

## Supported versions

This project is pre-1.0 and ships from `main`; fixes land on `main`. There is not yet a
supported-release matrix — assume only the latest `main` is maintained.

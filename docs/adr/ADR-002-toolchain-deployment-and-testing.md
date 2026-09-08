# ADR-002: TypeScript on the official SDK, stateless Streamable HTTP on Lambda, fixture-driven TDD

**Status:** accepted (2026-09-08) · **Affects:** `packages/*`, `infra/`, CI

## Context

Decision questions 2, 3, 4, 6 (license) and 8 from `docs/architecture.md`. The owner
accepted the recommended defaults on 2026-09-08.

## Decision

1. **Language and SDK.** TypeScript (strict), Node 22, the official
   `@modelcontextprotocol/sdk`, npm workspaces, vitest, Biome for lint and format.
   Rationale: both usable BLS donor codebases and the Census Bureau's official MCP
   server are TypeScript; consumers speak MCP over HTTP or stdio, so server language
   constrains nobody downstream. FastMCP 3 (Python) remains the documented fallback.
2. **Transports.** Every server builds to two entry points from one definition: stdio
   for local use, and Streamable HTTP in stateless JSON-response mode (no sessions, no
   SSE) for remote use.
3. **Hosting.** One AWS Lambda per server behind an HTTP API, defined in CDK
   (TypeScript), deployed only from CI on merge to `main` via an OIDC role. The same
   build must also run as a plain container and as a local process, so hosting stays
   portable (Cloudflare Workers is the named alternative). The target account, trust
   mechanics, domain and bootstrap are in ADR-004.
4. **Auth.** None for end users; the data is public. Agency API keys live in AWS Secrets
   Manager in deployed environments and in `.env` locally. Optional per-client usage
   plans at the API layer. Organizations needing caller identity or audit front the
   server with their own gateway.
5. **Testing.** TDD. Agency APIs are never called in unit tests; responses are recorded
   once into `fixtures/` and replayed. A contract suite runs against every server. Live
   smoke tests run only with `LIVE_TESTS=1` in a separate, non-gating CI job.
   Infrastructure is tested with CDK assertions.
6. **License.** Apache-2.0 for the repository. Compatible with the Apache-2.0 donor
   (cyanheads) and the MIT donors (pipeworx, b-barker); borrowed code is attributed in
   `NOTICE`.

## Consequences

- One toolchain for servers, infra and scripts.
- Lambda cold start budget constrains the geography catalog size (see ADR-003).
- Fixtures must be refreshed deliberately when an agency changes its response shape; a
  scheduled live smoke job is how we notice.

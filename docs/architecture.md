# federal-mcps — architecture

**Status:** current. Rulings recorded in ADR-001, ADR-002 and ADR-003 (2026-09-08).
Companion spikes: [`spikes/bls-mcp-benchmark.md`](spikes/bls-mcp-benchmark.md),
[`spikes/geography-catalog.md`](spikes/geography-catalog.md).

## Purpose

A family of MCP servers that give city and state policy staff federal statistics by
place. An analyst asks about Denver, Denver County, the Denver metro, or Colorado; every
server in the family understands the same place and returns numbers that carry their
source, vintage and caveats. BLS is the first server. Census and CDC PLACES follow on
the same core. The design should admit HUD, BEA, FEMA and others without rework.

## The one shared idea: geography

Each agency encodes places differently: BLS LAUS area codes, Census GEOIDs and summary
levels, CDC county and place FIPS, OMB CBSA codes. One shared **geography catalog**
resolves a place name to every agency's identifier and knows the containment hierarchy
(city in county in metro in state; tract, ZCTA, place, county subdivision, CBSA, metro
division, CSA). Every server resolves places through it, so results join across
agencies on a common GEOID. The catalog is designed in
[`spikes/geography-catalog.md`](spikes/geography-catalog.md).

## Multi-server, one core, one optional front door

**Decision: many agency servers with a shared core, not one government mega-server.**

Why separate servers:

- Tool schemas land in the model's context every turn. Six agencies at 8–12 tools each
  is 50–70 tools, where tool selection degrades. Agency servers stay at a readable size.
- Independent release cadence and blast radius. BLS revises monthly, ACS annually; a bad
  QCEW parser must not take down Census answers.
- Permissioning: agent frameworks and MCP hosts allow or deny at the connector level
  far more easily than per tool; agency-scoped servers make "labor data but not health
  data" a connector choice, not a per-tool allowlist.
- Registries list servers by what they do. "BLS labor statistics" is findable.
- One person can own one agency server end to end.

Where a single connector is genuinely better, and how we get it without merging:

- **Install friction.** A `server-composite` package mounts several agency servers under
  one URL with prefixed tool names (`bls_…`, `census_…`, `places_…`) and exposes a
  **single** `resolve_place` instead of one per agency. Same packages, one thin extra
  deployable. Analysts who want one connector get one; agents that want a narrow surface
  connect to the agency server directly.
- **Cross-agency questions** need all relevant tools in one conversation regardless;
  the composite is where that happens, and the shared GEOID is what makes the join work.
- **A plugin** installs the set of connectors plus skills for cross-agency workflows.

Alignment is enforced by code, not by a style guide: the core's `createServer` applies
the family's annotations and envelope, and the contract tests fail any server that
strays from the verb set or ships its own place lookup.

We deliberately do not start with a mega-server and split later; splitting untangles
shared state and renames tools agents already depend on, whereas adding a composite is
additive.

## Decisions (ruled 2026-09-08; see ADRs)

| # | Question | Recommended default | Why |
|---|---|---|---|
| 1 | Repo shape | One monorepo: `packages/core`, `packages/geography-build`, one `packages/server-<agency>` each, `packages/server-composite`, `infra/` | Keeps catalog, HTTP client and conventions from drifting; one CI. |
| 2 | Language / SDK | TypeScript, official `@modelcontextprotocol/sdk`, Node 22, vitest, Biome | Both usable BLS donor codebases and the Census Bureau's official server are TypeScript. Consumers talk MCP over HTTP or stdio, so the server language constrains nobody downstream. FastMCP 3 (Python, as OpenContext uses) is the fallback. |
| 3 | Deployment | Remote Streamable HTTP, stateless JSON-response mode, one AWS Lambda per server behind an HTTP API, defined in Terraform (ADR-005); stdio entry point for local dev. Target: Responsive City account via the fleet record in `instances.json` (ADR-004) | Stateless and cheap for public data with no sessions and no SSE; anyone can self-host the same container or run it locally over stdio. Cloudflare Workers is faster to first deploy; the code stays portable to either. |
| 4 | Auth | None for end users; agency API keys as sensitive Terraform variables on the Lambda (ADR-006); optional per-client usage plans | Public data. Anthropic directory accepts unauthenticated public-data connectors. Organizations that need caller identity or audit can front the server with their own gateway. |
| 5 | Tool pattern | One tool per action, 8–12 per server, family verb set | Surface is small once organized by place and indicator. Raw-ID `get_raw` is the escape hatch. |
| 6 | Geography catalog | Build-time SQLite shipped with each server, generated from Census/OMB/agency code tables | Read-only, versioned, no runtime database; removes the Census server's Postgres dependency for a Lambda. |
| 7 | Census strategy | Adapt the official `uscensusbureau/us-census-bureau-data-api-mcp` (CC0, TypeScript) onto the core; contribute upstream where it fits | Already solves dataset discovery and FIPS resolution with CI and tests. We replace its Postgres and stdio-only transport. |
| 8 | Testing | TDD; recorded fixtures; contract tests on every tool; live smoke tests gated by `LIVE_TESTS=1` | Agency APIs are slow and rate-limited; conventions are enforced mechanically. |

## Repository layout

```
federal-mcps/
  packages/
    core/                 shared runtime for every server
      src/geography/      place resolver, GEOID crosswalks, SQLite loader
      src/http/           fetch with retry, backoff, quota budget, tiered cache
      src/envelope/       provenance envelope + typed result shapes
      src/server/         createServer(), tool registration, stdio + HTTP entry points
      src/testing/        fixture recorder, contract-test helpers
    geography-build/      generates the SQLite catalog (see geography spike)
    server-bls/           Bureau of Labor Statistics
    server-census/        adapted from the official Census Bureau server
    server-cdc-places/    CDC PLACES via data.cdc.gov (Socrata SODA)
    server-composite/     one endpoint mounting several servers, shared resolve_place
  terraform/              bootstrap/, modules/, instances/<name>/ (ADR-005)
  scripts/                fleet-record loader, backend-config helper, infra gates
  docs/                   this document, adr/, spikes/, stories/, archive/
  .github/workflows/      lint, test, geography-build, deploy
```

## The shared core

**Geography.** `resolvePlace(query, {kind?, state?})` returns ranked candidates, each
carrying every identifier the family knows (GEOID, state and county FIPS, CBSA, Census
summary level, LAUS area code, CES SM area code, OEWS area code, CPI area code where one
exists) plus its parents. It handles city-vs-county name collisions, cities below the
LAUS 25,000 threshold falling back to county, metro vs metro division, consolidated
cities, and New England NECTAs.

**HTTP discipline.** One client: retry with jittered backoff on 5xx/429, timeout,
per-source daily budget counter (DynamoDB in Lambda, memory locally), two-tier cache
(fresh TTL by release cadence, stale fallback when the agency is down), batching hooks
so BLS packs 50 series per call and Census packs variables per call.

**Provenance envelope.** Every tool returns `data`, `place` (the resolved geography, so
the caller can confirm), `source` (agency, dataset, series/variable IDs, URL),
`retrievedAt`, `vintage`, `footnotes`, `limitations`, `cache`.

**Server shell.** `createServer(definition)` registers tools with `readOnlyHint: true`,
attaches the envelope, wires both transports, adds `describe_source` and prompts. The
contract suite asserts naming, annotations and envelope shape.

### Family verbs

| Verb | Purpose | Input |
|---|---|---|
| `resolve_place` | Place name → identifiers; confirm before fetching | query, kind?, state? |
| `list_indicators` | Browse/search what this source reports for a place kind | query?, place_kind?, topic? |
| `get_indicator` | One indicator, one place, over time | indicator, place, start?, end? |
| `compare_places` | One indicator across places, aligned on period | indicator, places[], period? |
| `get_raw` | Raw series/variable IDs for experts | ids[], start?, end? |
| `describe_source` | Coverage, cadence, caveats, citation format | — |

In the composite server, `resolve_place` is unprefixed and shared; agency tools are
prefixed (`bls_get_indicator`).

## Server one: BLS

Donors: LABSTAT catalog harvester and observation mirror from
`cyanheads/bls-labor-mcp-server` (Apache-2.0); OEWS series builder from
`b-barker/bls-oews-mcp` (MIT); LAUS place-resolver design from `pipeworx-io/mcp-bls`
(MIT). See the benchmark spike for why nothing was forked whole.

The BLS server exposes the family verb set (ADR-009 §1), not program-named tools: the
model triggers a verb and the server owns the verb → series-id → endpoint mapping, so
each program is an *indicator* behind `get_indicator`, never a tool of its own.

| Tool | Status | Note |
|---|---|---|
| `bls_resolve_place` | available | core resolver with BLS area codes and coverage flags attached |
| `bls_list_indicators` | available | the measures a program publishes, and whether it publishes at a place's level |
| `bls_get_indicator` | available (LAUS, CES, OEWS, CPI, JOLTS) | one indicator, one place, over time; a place below a program's coverage falls back (LAUS→county, CPI→U.S. city average) with a caveat |
| `bls_compare_places` | available | one indicator across ≤20 places, aligned on the latest shared period; a thin wrapper over `get_indicator` |
| `bls_get_raw` | available | raw series IDs, ≤50, auto-chunked past 20 years |
| `bls_describe_source` | available | coverage, cadence, caveats, citation format |

Program coverage behind these verbs (from `bls_describe_source`):

| Program | Status | Local granularity | Measures |
|---|---|---|---|
| LAUS | available (M3) | state, MSA, county, city ≥25k | unemployment rate, unemployment, employment, labor force |
| CES State & Area | available (M4) | state (metro/CBSA arriving, #110) | total nonfarm payroll employment |
| OEWS | available (M4) | state (metro arriving) | all-occupations mean annual wage |
| CPI | available (M4) | ~23 metros + U.S. city average | all items; no local CPI → U.S. city average, flagged |
| JOLTS | available (M4) | state | openings, hires, quits, layoffs |
| QCEW | M5 | county, MSA, state | employment and wages by NAICS and ownership; CSV client, not the timeseries API |

Internals: pure series-ID builders per program with a unit test each against a
published ID; 500/day quota via batching, chunking and a budget counter; the LAUS
timeseries fetch runs through the core HTTP client (retry/backoff, budget counter,
two-tier cache); an optional LABSTAT observation mirror for LAUS and SM is deferred to
spike #51; the QCEW client over
`data.bls.gov/cew/data/api/{year}/{qtr}/area/{code}.csv` lands in M5;
preliminary/revised flags are surfaced from footnote codes.

## Servers two and three

**Census.** Start from the official server. Keep dataset discovery, variable groups and
geography semantics. Replace Postgres with the shared SQLite catalog, add HTTP transport
and envelope, add place-first ACS convenience tools (population, income and poverty,
housing, commuting) with correct 1-year vs 5-year vintage rules for small places. QWI
is a natural second phase.

**CDC PLACES.** Model-based health estimates for every county, place, tract and ZCTA,
~40 measures, via the Socrata SODA API on data.cdc.gov. Annual release, long cache TTL.

Later, with no core changes: HUD (FMR, CHAS), BEA regional (county GDP, personal
income), FEMA National Risk Index, County Health Rankings, Census QWI and Building
Permits.

## Release 1: BLS only

**Ruling (2026-09-08): this release ships the BLS server alone.** The core and the
geography catalog are built so that Census, CDC PLACES and the composite endpoint can
follow without rework, but no code for them lands in Release 1. Every core interface
is judged by one test: would a second agency server need to change it?

Milestones are major components of functionality, each independently verifiable and
each leaving `main` in a releasable state. Six rather than one because the geography
catalog and the QCEW client carry their own risk and deserve their own exit gates, and
because the timeseries-API programs can ship to early users before QCEW is done.

| Milestone | Component | Exit criterion |
|---|---|---|
| **M1 Foundation** | Monorepo; `packages/core` server shell with stdio and Streamable HTTP; core HTTP client (retry, backoff, budget counter, cache); provenance envelope; contract-test harness; CI (lint, typecheck, test, contract); CDK stack that deploys one Lambda from CI | A hello-world server with `describe_source` passes contract tests and deploys on merge; the same build runs over stdio in Claude Code |
| **M2 Geography catalog** | geography-build pipeline; SQLite catalog with weighted-overlap shares and 2010→2020 tract lineage; `resolvePlace` with ambiguity status, county fallback and structured flags; `geography://guide`; a hosted `server-geo` (`geo-mcp.responsive.city`); `bls_resolve_place` via `core.geographyTools()` (ADR-008) | UGEO-Bench runs in-repo and a small model shows a demonstrable lift with the geography tools; "Denver" resolves to city/county/metro/CSA with every BLS code and structured flags; `server-geo` live |
| **M3 Labor market core** | LAUS only (ADR-009): series-ID builder, `bls_get_indicator`, `bls_list_indicators`, `bls_get_raw` (raw, batched, chunked), LAUS flipped to `available` in `bls_describe_source`; recorded fixtures; quota enforcement end to end | Unemployment questions for any state, metro, county or ≥25k city answer from fixtures in tests and from the live API in the smoke job, with the below-threshold county fallback; preliminary flags surface in the envelope |
| **M4 Wages, prices, openings** | A program registry generalizing `bls_get_indicator` off LAUS; CES, OEWS, CPI and JOLTS builders + indicators; `bls_compare_places`; CPI's ~23-metro codes with a U.S.-city-average fallback. State-level for CES/OEWS (metro CES is #110) | Payroll, wage, price and job-openings questions answer through the family verbs; comparing places on one indicator returns period-aligned rows; only QCEW remains planned |
| **M5 QCEW** | CSV slice client over `data.bls.gov/cew/data/api`, typed parsing, annual and quarterly, ownership and NAICS filters, exposed as QCEW indicators behind `bls_get_indicator`; long-TTL cache | County employment and wages by industry for any county, MSA or state, with suppression codes carried as caveats |
| **M6 Release hardening** | Optional LABSTAT observation mirror for LAUS and SM; eval set of real policy questions run against the deployed server; README, install docs for Claude, Claude Code and one third-party host; Anthropic directory submission; tagged v1.0.0 | Eval set passes at an agreed threshold; a new user installs and gets a cited answer without reading source |

Deferred to later releases, deliberately: Census server, CDC PLACES server,
`server-composite`, the plugin with cross-agency skills, Wikidata aliases, full
multi-vintage geography.

## Deployment

Per ADR-004 and ADR-006: `instances.json` is the fleet record; Release 1 has one instance, `dev`, in
the Responsive City account (`564762345093`, `us-east-1`). Each server has its own
hostname following the account's `<service>.responsive.city` pattern:
`bls-mcp.responsive.city/mcp` in Release 1.

Deploys are local, matching the account pattern (ADR-007): the account has no CI deploy
path, so a person runs `scripts/deploy.sh dev` under `AWS_PROFILE=rc-deploy`. The script
resolves the instance through `scripts/instance.mjs` (the same loader the tests use, so
no account, region or hostname is hardcoded), builds and bundles the BLS server, runs
`terraform init` / `plan` / `apply` in `terraform/instances/dev` against the account's
pre-existing `rc-tfstate` bucket, then verifies the live deploy by calling `initialize`
then `tools/list` on the deployed endpoint, failing unless `bls_describe_source` is
present, and prints `deployed <sha> to <url>`. CI (`ci.yml`) validates the Terraform
(`fmt`, `validate`, `test`, `tflint`) on every push and pull request but never applies.
Nothing needs bootstrapping: `rc-deploy` can create the `rc-bls-mcp-dev` Lambda, its
role, the HTTP API, the certificate and the DNS records, and read and write this
project's state. Push-to-deploy remains a documented upgrade path (an administrator
creates the OIDC provider and a deploy role once).

## Repository settings

Recorded here so they can be re-applied to a fork or a new instance repo. Branch
protection requires a public repository or GitHub Pro; until the repository is public
the `CLAUDE.md` merge discipline is the only enforcement:

- `main` protection (intended): pull requests required, the `ci` status check required and
  strict (branch up to date), no force pushes, no deletions, conversation resolution
  required. Administrators are not exempt.
- Dependabot: weekly, Mondays, npm and GitHub Actions, grouped (dev tooling, runtime,
  actions), labeled `infra`.
- The `live-smoke` workflow is scheduled weekly and never a required check.

## Decision log

Questions 1–4, 6 and 8 were ruled on 2026-09-08 and are encoded in ADR-001 (shape, Census strategy, independence), ADR-002 (language, deployment, auth, testing, license), ADR-003 (geography), ADR-004 (target account and trust) and ADR-005 (Terraform, superseding the CDK parts of ADR-002 and ADR-004). Question 5 (milestone split) was ruled: six milestones as listed. Question 7 (Census) is encoded in ADR-001 but no Census code lands in Release 1.

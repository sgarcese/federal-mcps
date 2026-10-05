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
(city in county in metro in state in nation; tract, ZCTA, place, county subdivision, CBSA,
metro division, CSA). Every server resolves places through it, so results join across
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
| 7 | Census strategy | Build `server-census` on the core as `server-bls` was built; borrow the official `uscensusbureau/us-census-bureau-data-api-mcp` (CC0) dataset/table index and Census API query grammar as data, not code (ruled 2026-09-18, [spike](spikes/census-server-suitability.md)) | Upstream went quiet in 2026-03, is Postgres/Docker/stdio-bound, returns free text with no caveats, and duplicates the geography the catalog carries; its skeleton is what the core replaces. |
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
    server-census/        Census server on the core (M8, ADR-014): ACS indicators with reliability data
    server-hud/           HUD User API server (M11, ADR-018): FMR, Income Limits/MTSP, CHAS, Picture
    server-bea/           BEA Regional server (M14, ADR-019): personal income, GDP by industry, RPPs
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

County subdivisions (summary level 060: towns, townships, MCDs, CCDs) are a national
catalog level (#241), nested in their counties. A place and the county subdivision that
is the same municipality are linked by a place → town edge (same state and FIPS code, or
a consolidated town unique by name in its state) and resolve as one candidate, the town
among its parents. Much smaller same-name towns elsewhere never make a city ambiguous;
same-name towns in one state with none dominant ask for the county, and a query can name
it (`"Cranberry, Butler County, PA"`) or give a GEOID. Towns carry their LAUS `CS` code
where BLS publishes one, and a recoded town (Connecticut's 2022 planning regions) its
2020 GEOID as a `census`/`GEOID2020` code, so agencies that still publish under the old
id — HUD New England FMR and Income Limits — can be reached for every year.

A state — the `state` argument or a trailing `", CO"` — narrows every kind. A metro has no
state of its own, so it matches when the state is in its title or one of its counties is
(`"Chicago-Naperville-Elgin, IN"`). With no kind given, a metro found this way answers only
when nothing else matches exactly, so `"Denver, CO"` still means the city or the county (#293).

The same 10× population rule settles a state against a smaller same-name place (#291): an
exact match a tenth of the state's size or less is listed after it but neither wins nor makes
the query ambiguous, so "Colorado" is the state and Colorado County, TX comes second; New York
and Utah, where the city or county is larger than that, still ask which is meant. A state
chosen this way carries the `dominant_match` flag, and every answer's first limitation names the
places it passed over and how to ask for one (#309): "Washington" is the state, and says that
it also names Washington city, DC.

The United States is a catalog place too (#290): summary level 010, UCGID `0100000US` (Census's
own), GEOID `US` (TIGER's nation GEOID), Data Commons `country/USA`, the parent of every state
(the 50 states and DC — Puerto Rico is not in Census's 010) and every region. Its aliases ("US",
"U.S.", "USA", "United States of America", "nation", …) are hand rows in the build; "national" and
"America" are left out because they are real place names. The resolver takes kind `nation`
(`country`, `us`) and, below the trigram minimum of three characters, answers only the nation's
exact short aliases ("US"); an exact nation match is looked up directly rather than through the
trigram page. A server reads the nation as it reads any place: with a national series of its own
(BLS: CPS, CES national, JOLTS, OEWS, CPI U.S. city average, QCEW US000; Census: the same `ucgid`
query), or an "unavailable" answer saying the program has no national series here (HUD User, BEA).

Each entity also carries an ACS 5-year total population (`B01003_001E`) and the vintage
it reflects (e.g. "2024" meaning the 2020–2024 5-year), populated by `geography-build`
from the Census Data API at catalog-build time — no runtime call. `PlaceCandidate.population`
exposes it (null for regions/divisions and any entity the build had no row for; the nation's comes
from `for=us:*`). Coverage
rules that depend on population (e.g. ACS's 1-year-vs-5-year product choice, ADR-014 §2)
read this column instead of estimating population themselves. Because the Census Data API
now requires a key on every data query, building the catalog (`npm run geography:build`)
requires `CENSUS_API_KEY` in the environment; the build fails loudly, before downloading
anything, when it is unset (sign up free at https://api.census.gov/data/key_signup.html).

**HTTP discipline.** One client: retry with jittered backoff on 5xx/429, timeout,
per-source daily budget counter (in memory, per Lambda container — not shared across
containers), two-tier cache (a fresh TTL each caller sets by release cadence, and a longer
stale window behind it, served when a refresh fails or is refused: QCEW, Census (ACS,
decennial, `census_get_raw`) and HUD 30 days fresh and 90 stale; BEA 7 days fresh and 28
stale; BLS timeseries 24h fresh and 7 days stale. The rule is four times fresh, capped at 90
days; a request with no stale window gets none beyond its fresh TTL), batching hooks so BLS
packs 50 series per call and Census packs variables per call. A BLS timeseries POST's own
registration key never affects the cache or fixture identity (`cacheBody`, #325); a BLS
daily-threshold refusal — HTTP 200 with `REQUEST_NOT_PROCESSED` — is never cached and surfaces
as the shared `QuotaExceededError` (ADR-020 §8), same as the budget counter's own refusal.
**Stale first** (ADR-020 §4, #323): when a share or the service budget refuses an upstream
query (`LimitExceededError` or `QuotaExceededError`) and the cache holds the request within
its stale window, the client answers from cache instead of raising the refusal, and the
answer carries the limitation "Served from cache (retrieved …): today's <scope> share for
<source> is spent; resets …".

**Provenance envelope.** Every tool returns `data`, `place` (the resolved geography, so
the caller can confirm), `source` (agency, dataset, series/variable IDs, URL),
`retrievedAt`, `vintage`, `footnotes`, `limitations`, `cache`. A refusal (ADR-020 §4) is an
`isError` result whose text is one plain sentence (what was limited, whose share, the number,
the reset time and, for upstream queries, the tools that still work) and whose envelope has
`data: null`, the sentence as its limitation, and a `limit` block: `scope` (network, pool or
service), `kind` (upstream or toolCalls), `source`, `limit`, `used` and `resetsAt`. `limit`
and `used` are absent only when an agency refused on its own count without stating it (BLS's
daily threshold). The contract rule `refusal-shape` enforces it. With a limits configuration,
`describe_source` adds a `limits` block: the network and pool shares, and each service budget
with today's use and remaining queries.

**Server shell.** `createServer(definition)` registers tools with a human-readable `title`
and `readOnlyHint: true`, attaches the envelope, wires both transports, adds
`describe_source` and prompts. The contract suite asserts naming, titles, annotations and
envelope shape.

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
| `bls_get_indicator` | available (LAUS, CES, OEWS, CPI, JOLTS, QCEW, PPI) | one indicator, one place, over time, plus optional `item` / `industry` / `ownership` / `occupation` pickers validated per indicator (ADR-013); a place below a program's coverage falls back (LAUS→county, CPI→division→region→U.S.) with a caveat; a national-scope indicator (PPI) takes no place; the United States answers from each program's national series (#290), LAUS's from CPS, labelled CPS |
| `bls_compare_places` | available | one indicator across ≤20 places, aligned on the latest shared period; a thin wrapper over `get_indicator` |
| `bls_get_raw` | available | raw timeseries IDs from any program (LAUS, CES, OEWS, CPI, JOLTS, PPI), at most 200 per call (4 BLS queries of up to 50 series each, #324), sent to BLS in batches of 50; a missing `startYear` or `endYear` is filled and a span over BLS's 20-year limit is capped, each stated as a limitation (#292) |
| `bls_describe_source` | available | coverage, cadence, caveats, citation format |

Program coverage behind these verbs (from `bls_describe_source`):

| Program | Status | Local granularity | Measures |
|---|---|---|---|
| LAUS | available (M3) | state, MSA, county, city ≥25k; no national figure — the nation reads CPS (`LNU0…`/`LNS1…`, #290) | unemployment rate, unemployment, employment, labor force |
| CES State & Area | available (M4, metros completed M7) | state and metro (CBSA); a multi-state metro is filed under its first state with a caveat; the nation reads CES national (`CEU0000000001`, #290) | total nonfarm payroll employment |
| OEWS | available (M4, M7) | nation, state and metro | mean annual wage, all occupations or one of 22 SOC major groups (`occupation`) |
| CPI | available (M4, M7) | ~23 metros, census divisions and regions, U.S. city average | CPI-U by expenditure group (`item`); no local CPI → division → region → U.S., each flagged |
| JOLTS | available (M4) | nation and state | openings, hires, quits, layoffs |
| QCEW | available (M5, M7) | nation (US000), county, state and metro | covered employment, average weekly wage by NAICS sector (`industry`) and ownership; CSV client, not the timeseries API |
| PPI | available (M7) | national only | final demand and commodity indexes (`item`), e.g. inputs to construction, lumber, steel, concrete |

Internals: pure series-ID builders per program with a unit test each against a
published ID; 500/day quota via batching, chunking and a budget counter; the LAUS
timeseries fetch runs through the core HTTP client (retry/backoff, budget counter,
two-tier cache); an optional LABSTAT observation mirror for LAUS and SM is deferred to
spike #51; the QCEW client over
`data.bls.gov/cew/data/api/{year}/{qtr}/area/{code}.csv` lands in M5;
preliminary/revised flags are surfaced from footnote codes.

## Two surfaces per source (ADR-015)

Not every source earns a server. A source whose API has an id grammar (BLS series ids, Census
variable strings), needs quota or caching discipline, or whose contract a host relies on, ships
as a server on the core. A source hosted on a data portal (Socrata, CKAN, ArcGIS Hub,
OpenDataSoft) ships as a **source guide**: an Agent Skill under `skills/<source>/` used with
`geo-mcp` for place resolution and a generic [OpenContext](https://github.com/thealphacubicle/OpenContext)
connector for the portal. The 2026-09-20 benchmark (`docs/spikes/opencontext-socrata-benchmark.md`)
showed a guide takes a fresh model from 5/7 to 7/7 on CDC PLACES. CDC PLACES and HUD Open Data
(the ArcGIS Hub) are guides; the HUD User API, token-gated and rate-limited, is a server
(ADR-018 amends ADR-015: HUD is two sources). FEMA and BEA are decided by the same test.

## Servers two and three

**Census.** Start from the official server. Keep dataset discovery, variable groups and
geography semantics. Replace Postgres with the shared SQLite catalog, add HTTP transport
and envelope, add place-first ACS convenience tools (population, income and poverty,
housing, commuting) with correct 1-year vs 5-year vintage rules for small places. QWI
is a natural second phase.

**CDC PLACES.** Model-based health estimates for every county, place, tract and ZCTA,
~40 measures, via the Socrata SODA API on data.cdc.gov. Annual release, long cache TTL.

Later, with no core changes: FEMA National Risk Index, County Health Rankings, Census QWI and Building
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
| **M4 Wages, prices, openings** | A program registry generalizing `bls_get_indicator` off LAUS; CES, OEWS, CPI and JOLTS builders + indicators; `bls_compare_places`; CPI's ~23-metro codes with a U.S.-city-average fallback. state-level for OEWS; CES adds single-state metros | Payroll, wage, price and job-openings questions answer through the family verbs; comparing places on one indicator returns period-aligned rows |
| **M7 Functional completions** | A dimension seam on the registry (`IndicatorDefinition.dimensions`, ADR-013); CPI item, QCEW industry/ownership and OEWS occupation pickers; OEWS and QCEW metros, CES multi-state metros, Census regions and divisions in the catalog with the CPI fallback ladder; PPI as a national-scope program; `caveatOf` and agency-code notes so a direct series can carry a condition | Inflation by type of good by metro, construction-sector wages by county, occupational wages by metro, and national producer prices all answer through the same verbs, every gap flagged |
| **M5 QCEW** | A registry fetch-capability seam (ADR-011 §2) so a non-timeseries program dispatches behind `bls_get_indicator`; a CSV slice client over `data.bls.gov/cew/data/api` with long-TTL cache; `covered_employment` + `average_weekly_wage` at county and state. Metro (`C`-code) and NAICS/ownership pickers deferred | Covered employment and average weekly wage for any county or state answer through the family verbs, with disclosure suppressions carried as caveats |
| **M6 Release hardening** | Optional LABSTAT observation mirror for LAUS and SM; eval set of real policy questions run against the deployed server; README, install docs for Claude, Claude Code and one third-party host; Anthropic directory submission; tagged v1.0.0 | Eval set passes at an agreed threshold; a new user installs and gets a cited answer without reading source |

## Release 2: Census

| Milestone | Component | Exit criterion |
|---|---|---|
| **M8 Census server** (ADR-014) | `packages/server-census` on the core: thirteen ACS headline indicators plus the 2020 decennial count on the registry seam; an ACS fetch capability choosing 1-year (≥65,000) or 5-year by a catalog population column, with margins of error, coefficient-of-variation reliability grades and annotation sentinels as first-class envelope data; `census_compare_places` aligned on one product; `census_get_raw` carrying the Census API grammar; `census_search_tables` over a vendored table index; the key as `queryAuth` (never cached, recorded or logged); its own Terraform module and hostname | Demographic questions for any place answer with a margin, a grade and the product stated; a small city is never given a one-year figure; the eval set's Census cases pass live at `census-mcp.responsive.city` |

## Release 3: HUD User

| Milestone | Component | Exit criterion |
|---|---|---|
| **M11 HUD User server** (ADR-018) | `packages/server-hud` on the core: a per-minute limiter in the core HTTP client; the bearer token as a header (never cached, recorded or logged); entity ids built from the catalog; `fair_market_rent`, `income_limit`, `area_median_income`, `mtsp_limit`, CHAS cost-burden share and count, Picture of Subsidized Households indicators with city→county fallback; `hud_get_raw` over the five endpoints; HUD User's required sentence on every citation; its own Terraform module and hostname | Rent, income-limit, cost-burden and subsidized-housing questions answer through the family verbs with the fiscal year or release stated; the HUD eval sets pass live at `hud-user.responsive.city` |

## Release 4: BEA Regional

| Milestone | Component | Exit criterion |
|---|---|---|
| **M14 BEA regional server** (ADR-019) | `packages/server-bea` on the core: a response `sanitize` hook and HTTP-200 body errors in the core client (BEA echoes the key and answers errors with 200); `bea`/`GEOFIPS` combination codes and county → CBSA edges in the catalog; personal income (county, state, state quarterly), GDP and real GDP by NAICS industry, regional price parities (metro, state, state nonmetro portion); sentinels never numbers; compare in one upstream call; `bea_get_raw` in BEA's grammar; BEA's required sentence on every citation; its own Terraform module and hostname | Income, GDP and cost-of-living questions for any county, state or metro answer through the family verbs with BEA's release note; the BEA eval sets pass live at `bea.responsive.city` |

Deferred to later releases, deliberately: sub-dimension pickers for Census (by race, age, tenure), ACS significance testing, SAIPE/PEP, CDC PLACES server,
`server-composite`, the plugin with cross-agency skills, Wikidata aliases, full
multi-vintage geography.

## Deployment

Per ADR-004 and ADR-006: `instances.json` is the fleet record; Release 1 has one instance, `dev`, in
the Responsive City account (`us-east-1`; the account id lives in the gitignored
`instances.json`). Each server has its own
hostname following the account's `<service>.responsive.city` pattern:
`bls.responsive.city/mcp`, `census.responsive.city/mcp`, `hud-user.responsive.city/mcp`,
`bea.responsive.city/mcp`, `geo.responsive.city/mcp` (ADR-016 §2; the
Release 1 `*-mcp` names remain as aliases). Guide-backed sources this family owns get an
OpenContext portal Lambda from the same wrapper — `cdc.responsive.city/mcp` for data.cdc.gov —
built from the commit pinned in `opencontext.lock.json` (ADR-016 §4-5).

Deploys are local, matching the account pattern (ADR-007): the account has no CI deploy
path, so a person runs `scripts/deploy.sh dev` under `AWS_PROFILE=rc-deploy`. The script
resolves the instance through `scripts/instance.mjs` (the same loader the tests use, so
no account, region or hostname is hardcoded), builds and bundles the BLS server, runs
`terraform init` / `plan` / `apply` in `terraform/instances/dev` against the account's
pre-existing `rc-tfstate` bucket, then verifies the live deploy by calling `initialize`
then `tools/list` on the deployed endpoint, failing unless `bls_describe_source` is
present, and prints `deployed <sha> to <url>`. CI (`ci.yml`) validates the Terraform
(`fmt`, `validate`, `test`, `tflint`) on every push and pull request but never applies.
`rc-deploy` creates each server's Lambda, HTTP API, certificate and DNS records, and reads
and writes this project's state; it cannot create IAM roles (ADR-007), so an administrator
creates each server's execution role once with `scripts/admin-create-exec-role.sh`
(`docs/runbooks/bootstrap-instance.md`). Push-to-deploy remains a documented upgrade path (an administrator
creates the OIDC provider and a deploy role once).

## Limits

The endpoints are public and unauthenticated, so core also enforces fair-use limits without
accounts (M17, ADR-020). `identify()` turns an *attested* source address (the Lambda adapter's
header, checked against an in-process nonce so a client cannot claim one) into a `Caller`: a
hashed, daily-rotating key for one network, or the fixed key for the shared claude.ai egress
pool (`160.79.104.0/21`), since every claude.ai user arrives from that one range. A persistent
limiter (DynamoDB counters, shared across every container) charges each tool call against the
caller's daily tool-call share and each upstream fetch against both the caller's daily upstream
share and the server's whole-service upstream budget (e.g. BLS's 490-a-day). If the store
itself fails, per-identity shares fail open and the service budget falls back to an in-memory,
per-container count, so a DynamoDB outage degrades protection rather than taking the servers
down. A refusal is never a silent or empty answer: it is an `isError` tool result with one
plain sentence naming what was limited, whose share it was, the number and the reset time, plus
an envelope-shaped `structuredContent` (`data: null`) carrying a `limit` block
(`scope`/`kind`/`source`/`limit`/`used`/`resetsAt`) so a host that reads structure gets the same
facts; `describe_source` exposes the configured limits and today's remaining service budget to
any caller. A sensitive operator-bypass header exempts the project's own release eval from the
per-identity shares (never the service budget), and self-hosted or stdio runs with no
`FEDERAL_MCPS_LIMITS` configured get no limiter at all, as before M17.

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

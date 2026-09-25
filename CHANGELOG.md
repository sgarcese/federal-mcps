# Changelog

All notable changes to federal-mcps. Versions follow ADR-012 §4: `0.x`, a minor bump per feature
milestone, patches for fixes; `1.0.0` is reserved for the API-stability commitment.

## Unreleased — M11 HUD User server

Added
- **Optional per-minute rate limiter on the shared HTTP client** (#231, ADR-018 §5): a
  token bucket configured per client via `createHttpClient({ perMinute, maxWaitMs? })`
  — not hard-coded, since HUD User's published 60 queries/minute/token may be revised.
  A request with no token available waits for the refill; a wait that would exceed
  `maxWaitMs` (default 60,000ms) throws a new `RateLimitWaitError` naming the source and
  the limit instead of calling `fetch`. Only a real upstream request consumes a token —
  cache hits and fixture replay never do. When a response carries
  `x-ratelimit-remaining: 0`, the bucket closes until that minute rolls over.

## 0.5.0 — M12 Raw access and BLS completions (2026-09-24)

Added
- **QCEW history and detailed industries** (#213, ADR-017 §4): with `startYear`/`endYear`, QCEW returns
  every published quarter in the range, newest first, from 2014, at most 5 years (20 quarters) per call
  with a note when capped; a new `frequency` picker (`quarterly` default, `annual` averages from the
  annual files); `industry` accepts any 3- to 6-digit NAICS code (e.g. 236), picked by its aggregation
  level, with a note when the area does not publish it. Without years an answer is still the latest
  quarter, so a plain call stays one file. Core: `DimensionDefinition.acceptsCode`/`openCodes`, a
  `frequency` dimension argument, `SeriesFetchOptions.explicitYears`, and `SeriesResult.notes` carried
  as limitations.

Changed
- **Raw tools reply with a compact table** (ADR-017): `census_get_raw` as CSV lines, `bls_get_raw` as
  one block per series, ids printed once, within 24,000 characters (indicator tools keep 4,000); a cut
  says "showing N of M" and how to narrow the call. The full result is unchanged in
  `structuredContent`. A new `raw-rendering` contract rule requires this of every `*_get_raw` tool (#210).

Fixed
- `bls_get_raw` accepts any BLS timeseries id, including national CES (`CEU2000000003`) and CPS
  (`LNU04000000`); malformed ids are still rejected (#211).
- An indicator that serves only its latest period says so when years were asked for, naming the period
  returned (used by OEWS, #214); QCEW answers cite the CSV file actually read
  (`data.bls.gov/cew/data/api/<year>/<q|a>/area/<area>.csv`) with the selection in words, not the
  internal key. Core: `IndicatorDefinition` gains `servesHistory`, `sourceOf` and `sourceHome` (#212).
- OEWS: `bls_describe_source` documents the series-id layout (area, industry, any 6-digit SOC, data
  type such as 13 annual median) with a worked detailed-occupation example, and `occupational_wage`
  states that the BLS API holds only the current OEWS year when a range is requested (#214).

Verification: `docs/evals/bls-m12.jsonl` adds six live cases (QCEW history, NAICS 236, annual averages,
an unpublished code, the OEWS horizon, national CES/CPS through `bls_get_raw`); run after deploy.

## 0.4.0 — M10 Deployment wrapper (2026-09-22)

Added
- **Short hostnames** `bls.responsive.city/mcp`, `census.responsive.city/mcp`, `geo.responsive.city/mcp`
  (ADR-016 §2) as aliases served by the same APIs; the `*-mcp` names remain and are advertised as
  aliases. Configured per fleet record (`domain.aliases`), verified by `scripts/deploy.sh`.
- **The CDC portal** `cdc.responsive.city/mcp`: an OpenContext Socrata Lambda on data.cdc.gov deployed
  by this repository's wrapper (`terraform/modules/opencontext-portal`, ADR-016 §5), the hosted
  connector behind the CDC PLACES source guide. OpenContext is pinned by commit in
  `opencontext.lock.json` and built at deploy time by `scripts/bundle-opencontext.sh` (ADR-016 §4);
  an optional `SOCRATA_APP_TOKEN` rides as a sensitive variable.
- Repository rulesets and security settings (ADR-016 §6, `docs/runbooks/repository-settings.md`).
- Resolver: same-name places across states stop as ambiguous unless one dominates by population;
  a trailing state in the query is honoured (#187).
- Source guides as skills (ADR-015, M9): `skills/cdc-places` and `skills/hud-open-data`, each with a
  guided eval set; both passed 7/7 against the live hostnames on release day.

Fixed
- The eval runner skips `*-guided.jsonl` sets instead of false-passing tool-less cases (#208).

Verified live (2026-09-22): all four hostnames and the three `*-mcp` aliases answer; runner 34/34
(BLS + Census sets) on the short names; CDC portal returns PLACES rows.

## 0.3.0 — M8 Census server (2026-09-19)

Added
- **`server-census`**, the family's second agency server (ADR-014), at `census-mcp.responsive.city`:
  thirteen ACS headline indicators (population, median age, median household and per capita income,
  poverty rate, unemployment rate, bachelor's or higher, uninsured share, mean commute, median rent,
  median home value, owner-occupied share, median housing cost) plus `decennial_population` (2020).
- **Reliability as data:** every ACS value carries its margin of error and a coefficient-of-variation
  grade; annotation sentinels return null with the Census meaning; open-ended medians return the
  bound with a caveat; controlled estimates keep the value with no margin.
- **Product by population:** 1-year at 65,000 people or more, 5-year below, chosen from a new catalog
  population column (ACS 2020–2024 totals on every entity) and always stated; a `product` argument
  overrides; `census_compare_places` aligns mixed-size places on the 5-year product and says so.
- `census_search_tables` over a vendored index of 3,078 ACS/decennial table groups; `census_get_raw`
  with the Census Data API's own query grammar.
- Core: the indicator registry, dimension seam and generic `get_indicator` / `compare_places` /
  `list_indicators` tools moved to `@federal-mcps/core` (BLS unchanged); `caveatOf` receives the
  chosen dimensions; an `alignDimensions` hook for comparisons; a `queryAuth` request option that
  appends credentials at fetch time only; Lambda bundles ship a server's `src/data/` assets.

Changed
- The Census Data API now requires a key on every data query; `CENSUS_API_KEY` is a build-time
  requirement for the geography catalog (population column) and a deployed environment variable.
- The Census API's required sentence ("This product uses the Census Bureau Data API but is not
  endorsed or certified by the Census Bureau.") is displayed by `census_describe_source`, the README
  and the connector docs.

## 0.2.0 — M7 functional completions (2026-09-18)

Added
- **Pickers** (ADR-013): optional `item`, `industry`, `ownership` and `occupation` arguments on
  `bls_get_indicator` and `bls_compare_places`, validated per indicator against curated
  vocabularies that `bls_list_indicators` publishes. CPI expenditure groups (10), QCEW NAICS sectors
  (21) and ownership (5), OEWS SOC major groups (22), PPI commodity indexes (17).
- **PPI**, the seventh program, national only: `producer_price_index` answers with no place and
  flags any place given as not a local figure.
- **Geography completions:** OEWS metros; CES multi-state metros (filed under their first state,
  with a caveat); QCEW metros via the catalog's C-codes; Census regions and divisions as catalog
  entities, with CPI falling back metro → division → region → U.S. city average, each step flagged.
- Agency-code notes travel from the catalog to the envelope (`caveatOf` on the registry).

Fixed
- `bls_get_raw` accepted only LAUS ids despite its description; it now accepts any timeseries id
  the server builds.
- QCEW sector detail with the default total ownership is rejected with guidance instead of
  returning an empty answer (QCEW publishes sectors by ownership only).

## 0.1.0 — M6 release hardening (2026-09-17)

The first release: six BLS programs (LAUS, CES, OEWS, CPI, JOLTS, QCEW) behind the family verbs
over the shared geography catalog; a Boston-grounded eval set against the live server; a
connector quickstart; the connector review criteria as a quality bar (tool titles, accurate
descriptions, privacy policy); a fresh checkout runs `npm test` with no build; the national
place → county crosswalk that makes the below-threshold LAUS fallback work everywhere.

Known limitations at 0.1.0 (addressed in 0.2.0): OEWS and QCEW metros, CES multi-state metros,
region/division CPI, and every sub-dimension picker.

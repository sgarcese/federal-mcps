# Spike: is the official Census Bureau MCP server a suitable base for `server-census`?

ADR-001 and the architecture (decision row 7) planned to **adapt** the official
`uscensusbureau/us-census-bureau-data-api-mcp` (CC0, TypeScript) onto the family core, replacing
its Postgres and stdio-only transport, and to contribute upstream where it fits. That plan was
made on 2026-09-08. This spike re-checks it on 2026-09-18 against what the server is now and
against the family contract as it stands after M7 (family verbs, provenance envelope, geography in
core, quota through the core client, built identifiers, caveats that travel).

## What the official server is today (verified 2026-09-18)

- **Activity.** 94 stars; last push 2026-03-13; last substantive commits 2026-02/03 (data-table
  search, components/programs tables). Nothing since — six months quiet. Version `1.0.0`.
- **Shape.** Two containers: a Postgres 16 database (`mcp-db`) seeded from the Census Data API
  (datasets, ~32,000 data tables concentrated in ACS/CPS/SIPP, topics, programs/components, years,
  summary levels, and geographies at nation, region, division, state, county, county subdivision,
  place and ZCTA from the `geoinfo` endpoints) and a stdio MCP server (`mcp-server`) that queries
  that database and the live API. Docker Compose is the only documented way to run it; a
  `CENSUS_API_KEY` is required.
- **Tools (five) and one prompt.**

  | Tool | What it does | How it answers |
  |---|---|---|
  | `list-datasets` | metadata for every API dataset | database |
  | `fetch-dataset-geography` | geography levels a dataset supports | live API |
  | `search-data-tables` | rank ~32k tables by id/label/endpoint | database (Postgres full-text) |
  | `resolve-geography-fips` | place name → FIPS, UCGID, query syntax, hierarchy | database (`search_geographies`) |
  | `fetch-aggregate-data` | raw Census API call: dataset + year + `get` variables/group + `for`/`in`/`ucgid` + predicates | live API, direct `node-fetch` |

  The prompt `get_population_data` tells the model to resolve a geography, then fetch.
- **Output shape.** Plain text: `"Response from acs/acs1:\n NAME: …, B01001_001E: …\n Source: U.S.
  Census Bureau Data API (<url with key REDACTED>)"`. No structured content, no output schema.
- **Engineering.** MCP SDK ^1.12, Zod schemas per tool with a validator that steers a dataset to
  the right tool, a `BaseTool`/`ToolRegistry` pattern, 20 vitest files (unit tests mock
  `node-fetch`; separate integration tests hit the live API), ESLint + Prettier, CI for build,
  lint, tests and DB tests, coverage badges. No tool annotations (`readOnlyHint`, `title`), no
  retry/backoff/cache/quota handling around the API, `console.log` of the request URL (including
  the key) on every fetch.

## Alignment against the family contract

| Family rule | Official server | Fit |
|---|---|---|
| **Family verbs** (`resolve_place`, `list_indicators`, `get_indicator`, `compare_places`, `get_raw`, `describe_source`), read-only, titled, annotated | Five differently-shaped tools; no annotations or titles; contract suite would fail every rule | **Not aligned.** `fetch-aggregate-data` is exactly our `get_raw` (a thin, expert escape hatch); nothing plays `get_indicator`, `compare_places` or `describe_source`; `search-data-tables` is a **discovery** verb the family does not have |
| **Provenance envelope** (value, place, source ids, vintage, footnotes, limitations, citation) | Free text with a URL citation; annotations (margins of error, `-666666666` sentinels, suppression) pass through unparsed | **Not aligned;** would be rebuilt from scratch on the shell |
| **Geography resolved once, in core** (no server-side place lookup) | Its own Postgres geography table and search functions; region/division, cousub, ZCTA covered — a real overlap with our catalog | **Conflicts.** Our catalog already carries everything it has except county subdivisions at scale and the Census `geoinfo` lat/lon; keeping both is exactly the duplication ADR-003 forbids |
| **Quota through the core HTTP client** (retry, backoff, cache, budget, fixtures) | Direct `node-fetch`; no cache, no retry; logs the key | **Not aligned;** every call would move onto our client |
| **Identifiers built, not typed** | Variables and table groups are typed by the model (`B01001_001E`, `S0101`), scoped by `search-data-tables` | **Different problem.** Census has ~32k tables × variables; a curated *indicator vocabulary* (our registry) is the right model-facing surface, with table search as the escape hatch behind it |
| **Numbers carry their caveats** | None: ACS margins of error, annotation values, and 1-year vs 5-year reliability are the model's problem | **Not aligned;** and this is the product's core value |
| **Deployable as a Lambda; no runtime database** (ADR-002/003/008) | Requires Postgres + Docker; stdio only | **Not aligned;** the database is the server's centre of gravity |
| **Tests: fixtures, agency API never in unit tests** | Unit tests mock fetch; integration tests hit the API (separate) | Compatible in spirit |
| **Licence** | CC0 | Compatible |

**What is genuinely reusable.** Three things, and they are *data and knowledge*, not code:

1. **The dataset/table/topic index** — the seed configs know which endpoints exist, which
   tables each carries per vintage, and the programs/components taxonomy. That is the raw material
   for a curated Census indicator vocabulary and for a `census_search_tables` discovery tool.
2. **The Census API query grammar** as encoded in `fetch-aggregate-data`'s Zod schema and
   validators (`for`/`in`/`ucgid`, group vs variables, predicates, `descriptive`). That is our
   `census_get_raw` input schema, nearly verbatim.
3. **The `geoinfo` seeding recipe** for county subdivisions and lat/lon — a source our
   geography-build could add if the Census server needs cousub resolution at scale.

Everything else — transport, envelope, geography, quota, caveats, tests — is what the family core
already provides and what the official server lacks. Adapting its code means keeping its
`BaseTool`/`ToolRegistry`/Postgres skeleton and replacing every organ; the skeleton is the part we
do not want.

## Verdict

**Do not fork or adapt the official server's code. Build `server-census` on the core, the way
`server-bls` was built, and borrow its data index and API grammar.** The 2026-09-08 plan assumed
the official server would keep evolving and that its geography and discovery would be worth
carrying; six months of silence, a Postgres dependency, free-text output and no caveat handling
make it a worse base than our own shell. Attribute the borrowed schema and seed recipes in
`NOTICE` (CC0 needs no attribution, but the project records provenance).

The judgment cases that made the BLS server valuable have direct Census analogues, and none of
them exist upstream: **margins of error** travelling with every ACS estimate; **1-year vs 5-year**
availability by population (ACS 1-year covers only areas ≥ 65,000, so a small city falls back to
the 5-year estimate, flagged — the LAUS threshold story again); **annotation values**
(`-666666666` and friends) as null-plus-caveat, never a number; and **decennial vs ACS** as
different universes. These are the spike-worthy questions for a Census milestone.

## Decisions (numbered; recommendations given)

### 1. Base
(a) adapt the official server's code onto the core; (b) build `server-census` on the core and
borrow the official server's dataset/table index and query grammar as data; (c) wait for upstream.
**Recommendation: (b).**

### 2. Model-facing surface
(a) expose the raw API grammar as the primary tool (as upstream does); (b) a **curated indicator
vocabulary** through `census_get_indicator` (population, median household income, poverty rate,
median rent, median home value, educational attainment, commute, health insurance coverage, …)
with ACS table/variable ids built per indicator and vintage, plus `census_get_raw` carrying
upstream's grammar for experts and `census_search_tables` for discovery. **Recommendation: (b);**
the registry seam from M4/M7 (`IndicatorDefinition` with dimensions and a fetch capability) fits
Census unchanged — ACS is one fetch capability, decennial another.

### 3. Caveats as first-class data
Every ACS value returns with its margin of error and a reliability note; annotation sentinels
become null + caveat; 1-year/5-year is chosen by population with the fallback flagged; vintage is
explicit. **Recommendation: yes, in the first Census milestone,** since it is the product's
differentiator and cheap once the envelope exists.

### 4. Geography
The core catalog serves `census_resolve_place` as it does for BLS. Add county subdivisions
nationally to the catalog (from the gazetteer, not the `geoinfo` API) only if a Census indicator
needs them (New England towns do). **Recommendation: reuse the catalog; add cousubs when a story
needs them.**

### 5. Quota and freshness
The Census API has no published daily cap comparable to BLS's 500, but keys are rate-limited and
ACS responses are large. All calls go through the core client with a long-TTL cache keyed by
(dataset, vintage, variables, geography); no mirror (consistent with the deferred #51).
**Recommendation: core client + cache, nothing more.**

### 6. Sequencing
A Census milestone (M8) after the M7 deploy is verified: spike on ACS indicator vocabulary and
the reliability rules → ADR → build (seam-first as M4/M5/M7). **Recommendation: cut the M8 spike
next; scope Release 2 to ACS 1-year/5-year headline indicators plus decennial population.**

## Out of scope for this spike

Composite endpoint, CDC PLACES, any change to the BLS server.

# Spike: M4 — Wages, prices, openings (CES · OEWS · CPI · JOLTS + compare_places)

M3 shipped the first real number (LAUS unemployment) over the family verbs, live end to end
(ADR-009, epic #79). M4 adds the next four BLS programs — Current Employment Statistics State &
Area (**CES S&A / SM**, payroll employment), Occupational Employment and Wage Statistics
(**OEWS / OE**, wages by occupation), the Consumer Price Index (**CPI / CU**, prices) and the
Job Openings and Labor Turnover Survey (**JOLTS / JT**, openings/hires/quits/layoffs) — plus the
`bls_compare_places` family verb. All four ride the same BLS timeseries API and reuse M3's
builder → cached-fetch → envelope pattern; QCEW (its own CSV client) stays in M5.

The mechanical parts (a pure series-id builder per program, unit-tested against a known-good
published id, per ADR-009 §3) are already licensed. This spike exists for what ADR-009 did **not**
settle: how `get_indicator` — today hardwired to LAUS — dispatches across programs, how much of each
program's sub-dimension (occupation, industry, item) M4 exposes, the shape of `compare_places`, and
how CPI's coarse geography is handled. Those are the owner's calls; build issues are cut from the
rulings, not before.

## What M4 builds

- A **program registry** turning `get_indicator`'s single-program LAUS path into a table of
  indicators, each mapped to its program, series-id builder, agency-code lookup and defaults.
- **CES S&A, OEWS, CPI, JOLTS** series-id builders + measure vocabularies, each registered.
- **`bls_compare_places`** — one indicator across several places, aligned on period.
- CPI's **area→geography map** (data) with "no local CPI" handling.
- Reconciliation: flip the four programs to `available` in `bls_describe_source`, extend
  `bls_list_indicators` across programs, update the architecture doc's M4 row (mirrors #84).

## The decisions (numbered; recommendations given)

### 1. Program dispatch: a flat indicator vocabulary over a registry, program hidden

Today `bls_get_indicator` hardcodes LAUS: the `indicator` enum *is* `LAUS_MEASURES`, `program` is
the literal `"LAUS"`, the agency-code lookup filters `program === "LAUS"`, and it calls
`buildLausSeriesId` directly. M4 must generalize this. The question is whether the model names an
`indicator` (the MCP owns which program and series-id that implies) or the tool grows an explicit
`program` argument.

**Recommendation:** keep a **flat `indicator` vocabulary** — `unemployment_rate`,
`payroll_employment`, `occupational_wage`, `cpi_all_items`, `job_openings`, … — backed by a
registry in `server-bls` mapping each indicator to `{ program, buildSeriesId, agencyCodeOf,
defaults }`. The model triggers a verb with an indicator name; the MCP owns
indicator → program → series-id, so the API shape never leaks (ADR-009 §1's principle, now the
load-bearing seam). No `program` argument. `bls_list_indicators` becomes the discovery surface that
names every indicator and which programs publish at a place's level. The family-verb dispatch stays
generic; the vocabulary is agency-specific and lives in `server-bls`.

### 2. Dimension depth: headline series in M4, sub-dimension pickers deferred

Three of the four programs have a large sub-dimension: OEWS by SOC **occupation**, CES by
NAICS **supersector/industry**, CPI by expenditure **item**. Exposing these fully means shipping
SOC/NAICS/item vocabulary tables and pickers.

**Recommendation:** M4 ships the **headline series** per program — total nonfarm for CES, all-items
for CPI, all-occupations (mean + median annual wage, plus employment) for OEWS, total openings/
hires/quits/layoffs for JOLTS — and **defers** occupation/industry/item pickers to a later
milestone. This is the smallest thing that answers the common question ("what are wages / prices /
job openings here?") and keeps M4 to builders + registry + compare, not vocabulary tables. The
registry (D1) leaves room to add a dimension argument later without reshaping the tool.

### 3. `bls_compare_places`: one indicator × N places, aligned on the latest common period

ADR-009 §8 called `compare_places` "a later thin wrapper over `get_indicator`." M4 is where it
lands, so its shape needs fixing.

**Recommendation:** input is one `indicator` and a list of `places` (each resolved through the same
resolver, with the same below-coverage fallbacks as `get_indicator`); output is one row per place,
**aligned on the latest period all places share**, each row carrying its value, footnotes and the
resolved place. Cap the list (recommend **≤ 20 places**) and batch the series through the BLS
50-series/query limit via the existing `fetchLausBatches` generalization. It reuses the registry's
builders — no new data path. A place that falls back (e.g. below-threshold city → county) is
labelled as such in its row, never dropped.

### 4. CPI geography: nearest published area, explicit "no local CPI", never fabricated

CPI does not publish for most places: only the U.S. city average, the four census regions, the
census divisions, and roughly 23 named metro areas. The resolver already flags this coverage; the
tool must not invent a local CPI.

**Recommendation:** a **hand-maintained CPI-area map** shipped as data (a small table, in the spirit
of ADR-008's code tables), keyed so a resolved place maps to its containing published CPI geography
(metro if one of the ~23, else division/region, else U.S. city average). `get_indicator` for a CPI
indicator returns that **nearest published geography's** value with an explicit caveat in the
envelope ("CPI is not published for <place>; showing <published area>") — mirroring the LAUS
below-threshold county fallback (ADR-009 §6). Never a fabricated or interpolated local index.

### 5. Seasonal adjustment and period: inherit ADR-009, with per-program defaults

ADR-009 §4–§5 set not-seasonally-adjusted below state and latest-~13-months. The new programs differ:
CES publishes SA at state/metro; OEWS is **annual** (no seasonality — a single yearly figure); CPI
publishes both SA and NSA; state-level JOLTS is NSA and limited.

**Recommendation:** **inherit** the ADR-009 defaults (NSA below state; latest by default, range on
request) and record a per-program default in the registry (D1): OEWS returns the latest annual
figure; CPI defaults NSA with the `seasonallyAdjusted` flag honored where published; CES defaults
NSA below state with SA on request where published; JOLTS returns the state NSA series. Where a
requested adjustment is not published, return the available series with an explicit note, never an
error (as LAUS does).

### 6. Data source: the BLS timeseries API, reusing the core client

All four programs (unlike QCEW) publish through `api.bls.gov/publicAPI/v2/timeseries/data` — the
same endpoint M3 uses.

**Recommendation:** **reuse** the core HTTP client and generalize `fetchLausBatches` into a
program-agnostic `fetchSeriesBatches` (retry/backoff, budget counter, two-tier cache, ≤50-series
batching, fixtures — #5). No new fetch path, no new quota surface. QCEW's CSV slice client stays
out of M4 (M5, ADR-009 §8).

### 7. Coverage and discovery: flip availability, list across programs

**Recommendation:** as each program lands, flip it `planned → available` in `bls_describe_source`
(as #84 did for LAUS), and extend `bls_list_indicators` to name every registered indicator and,
given a place, which programs publish at its level (using the resolver's `publishes_at`). Reconcile
the architecture doc's M4 milestone row to what shipped, in the same PRs (docs describe what is).

### 8. Scope boundary for M4

**Recommendation:** M4 = CES S&A, OEWS, CPI, JOLTS **headline** indicators behind
`bls_get_indicator`, plus `bls_compare_places`. **Out:** occupation/industry/item pickers (later),
QCEW's CSV client (M5), the LABSTAT hosted mirror (#51), and any non-timeseries-API program.

## Proposed build-issue cut (from the rulings, not before)

1. **Program registry** — generalize `get_indicator` from LAUS-hardcoded to an
   `indicator → { program, builder, agencyCodeOf, defaults }` registry; migrate LAUS onto it
   (no behaviour change) so it is the seam the rest consume. Generalize `fetchLausBatches` →
   `fetchSeriesBatches`.
2. **CES State & Area (SM)** series-id builder + payroll-employment vocab, unit-tested against a
   known-good SM id; registered with its defaults.
3. **OEWS (OE)** series-id builder + wage-statistic vocab (mean, median, employment) for
   all-occupations, unit test; registered (annual default).
4. **CPI (CU/CW)** series-id builder + all-items vocab + the CPI-area→geography map (data) +
   "no local CPI" handling; registered.
5. **JOLTS (JT)** series-id builder + openings/hires/quits/layoffs vocab (state), unit test;
   registered.
6. **`bls_compare_places`** — one indicator × N places, period-aligned, batched — over the registry
   builders; recorded fixtures + a `LIVE_TESTS=1` smoke.
7. **Reconcile** — flip CES/OEWS/CPI/JOLTS to `available` in `bls_describe_source`, extend
   `bls_list_indicators` across programs, update the architecture doc's M4 row; live-verify against
   the deployed server.

## Out of scope for M4

Occupation/industry/item sub-dimension pickers, QCEW's CSV client (M5), the LABSTAT hosted mirror
(#51), non-timeseries-API programs, and any new agency (Census/CDC are separate servers).

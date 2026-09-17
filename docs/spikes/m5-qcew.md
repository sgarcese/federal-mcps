# Spike: M5 — QCEW (employment and wages by industry, the first non-timeseries program)

M1–M4 delivered five BLS programs (LAUS, CES, OEWS, CPI, JOLTS) behind the family verbs, all on
the BLS Public Data **timeseries API** through the program registry (ADR-010 §1). M5 adds the
**Quarterly Census of Employment and Wages (QCEW)** — a near-census of covered employment and
wages, by industry and ownership, for counties, states and metros. QCEW is the first program that
does **not** use the timeseries API: it is distributed as **CSV area slices**, with no series id.
That break is what this spike is about — everything else (family verbs, resolver, envelope,
caveats) carries over.

## What QCEW is, verified against the live API

- **Access:** open CSV slices at `https://data.bls.gov/cew/data/api/{year}/{qtr}/area/{area}.csv`
  (no key, no 500/day cap). One slice is every ownership × industry row for that area and quarter.
- **Area codes:** county = 5-digit FIPS (`08031`), statewide = state FIPS + `000` (`08000`), MSA =
  a QCEW-specific `C`-code (`C1974` for the Denver CBSA `19740` — **not** the CBSA code), U.S. =
  `US000`. County and state are FIPS-mechanical; the MSA code is not a clean CBSA derivation.
- **Selecting a value:** there is no series id. A row is picked by `own_code` (0 = total covered,
  5 = private, 1–3 = government), `industry_code` (`10` = all industries), and `agglvl_code` (the
  aggregation level: 70 = county total, 50 = state total, 40 = MSA total). The headline county row
  (`own_code 0`, `industry_code 10`, `agglvl_code 70`) carries `month{1,2,3}_emplvl` (employment),
  `avg_wkly_wage`, `qtrly_estabs`, `total_qtrly_wages`, and more.
- **Suppression:** a `disclosure_code` column marks cells withheld for confidentiality — these are
  blank/suppressed values that must travel as a caveat, never dropped or fabricated.
- **Cadence:** quarterly, released ~5–6 months after the quarter, plus an annual-average release.

## What M5 builds

- A **CSV area-slice client** over `data.bls.gov/cew/data/api` through the core HTTP client
  (`getText`, long-TTL cache), parsing the headline row for a place.
- QCEW **indicators** (covered employment, average weekly wage) registered behind
  `bls_get_indicator` and `bls_compare_places`, with disclosure codes carried as caveats.
- Reconciliation: flip QCEW to `available` in `bls_describe_source`; update the docs.

## The decisions (numbered; recommendations given)

### 1. Data path: a CSV area-slice client through the core HTTP client

QCEW is not on the timeseries API. **Recommendation:** fetch the area CSV slice with the core
client's `getText` (retry/backoff, cache; the client already has it), parse it, and select the
headline row. QCEW's open API has **no 500/day cap**, so it does not consume the BLS timeseries
budget; a **long-TTL cache** keyed by `(area, year, quarter)` fits data that is fixed once
released. No direct `fetch` (CLAUDE.md) — reuse the shared client.

### 2. How QCEW fits the registry — the central question

The registry's `IndicatorDefinition` is built around `buildSeriesId` + a timeseries fetch. QCEW has
no series id; it fetches an area slice and picks a row by (ownership, industry, aggregation level).
**Recommendation:** generalize the registry so a definition supplies a **fetch capability**
(`fetch(place, options) → observations`) rather than only a series-id builder. The five timeseries
programs share the default capability (resolve agency code → build series id → timeseries fetch,
unchanged); QCEW provides a CSV capability. This keeps QCEW behind `bls_get_indicator` (family
verbs, ADR-010 §1 — never a program-named tool) and is the M5 analog of M4.1's registry seam.
`bls_compare_places` and `bls_get_raw` then work for QCEW for free. **Rejected:** a QCEW-specific
tool (breaks the family-verb contract).

### 3. Geographic scope: county and state now, MSA deferred

County (`SSCCC`) and state (`SS000`) QCEW area codes derive mechanically from the resolved place's
GEOID — no catalog column. The MSA code (`C1974`) is a QCEW-specific code that is **not** a clean
CBSA derivation, so it needs a mapping (build-time, like #110's CES metro key) or its own probe.
**Recommendation:** ship **county and state** headline in M5 (derived area codes, no catalog
change); defer **MSA** to a follow-up that adds the QCEW `C`-code to the catalog at build time —
mirroring how CES metros landed (#110). U.S.-total (`US000`) is a cheap add if wanted.

### 4. Headline measures and dimensions

QCEW's matrix is ownership × NAICS industry × size, with many measures. **Recommendation:** ship
the **total-covered, all-industries** headline (own_code 0, industry_code 10) with two indicators:
**`covered_employment`** and **`average_weekly_wage`**. (Note the name clash: LAUS already has
`employment` — QCEW's covered employment is a different concept, so it needs a distinct name.)
Defer NAICS-industry, ownership and size pickers, and the location-quotient / over-the-year-change
columns, to a later milestone — the same "headline first, pickers later" call M4 made (ADR-010 §2).

### 5. Suppression: disclosure codes are caveats, never dropped

QCEW withholds cells for confidentiality, flagged by `disclosure_code`. **Recommendation:** a
suppressed headline cell returns a **null value with an explicit disclosure caveat** in the
envelope (the QCEW code mapped to plain language), never a dropped or fabricated number — the same
discipline as the timeseries footnote flags ("numbers carry their caveats", ADR-009 §7).

### 6. Cadence, vintage and the default period

QCEW is quarterly (with an annual-average release) and lags ~5–6 months. A slice is fetched per
`(year, quarter)`. **Recommendation:** default to the **latest published quarter** — determined by
walking back from the current date's expected lag (or a small probe), returning the quarter fetched
as the vintage; accept an explicit `year`/`quarter`. Annual-average mode is a later add. Each value
carries its quarter and disclosure code.

### 7. Scope for M5

**Recommendation:** M5 = QCEW **county + state**, **total-covered all-industries**,
**`covered_employment` + `average_weekly_wage`**, behind `bls_get_indicator` and
`bls_compare_places`, with disclosure caveats. **Out:** MSA (the `C`-code mapping, a follow-up),
NAICS/ownership/size pickers, LQ and over-the-year columns, annual-average mode, and the LABSTAT
mirror (#51 — orthogonal; it addresses the timeseries programs' quota, not QCEW).

## Proposed build-issue cut (from the rulings, not before)

1. **Registry fetch-capability generalization** — let an `IndicatorDefinition` supply a fetch
   capability; migrate the five timeseries programs onto the default with no behaviour change (the
   M5 seam).
2. **QCEW CSV area-slice client** — `getText` over `data.bls.gov/cew/data/api`, long-TTL cache,
   parse + select the headline row by (own_code, industry_code, agglvl_code); disclosure handling;
   recorded fixtures + a `LIVE_TESTS=1` smoke.
3. **QCEW indicators** — `covered_employment` and `average_weekly_wage` (county + state), area code
   derived from the GEOID; registered; latest-quarter default.
4. **Reconcile** — flip QCEW to `available` in `bls_describe_source`; update `architecture.md`,
   `list_indicators` and the instructions; live-verify against the deployed server (mirrors #108).

## Out of scope for M5

QCEW MSA coverage (its `C`-code catalog mapping — a follow-up), NAICS/ownership/size dimension
pickers, location-quotient and over-the-year-change measures, annual-average mode, the LABSTAT
hosted mirror (#51), and any new agency (Census/CDC are separate servers).

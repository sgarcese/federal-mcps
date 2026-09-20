# Spike: M9 — the CDC PLACES server (model-based health estimates by place, with their intervals)

> **Status (2026-09-20): deferred.** The owner chose to test the geo resolver + OpenContext
> Socrata connector as a reusable alternative before building a server; see
> [opencontext-socrata-benchmark.md](opencontext-socrata-benchmark.md) for the result and two
> corrections to the facts below (suppression is county-only; age-adjusted prevalence is
> county/place-only — tract and ZCTA files carry crude prevalence only).

The family's third agency server (ADR-001). PLACES ("Local Data for Better Health") is the CDC's
small-area estimation product: forty chronic-disease, prevention, disability, social-need,
risk-behavior and health-status measures for every county, incorporated place and CDP, census
tract and ZCTA, published on `data.cdc.gov` (Socrata). This spike settles what the server answers,
what it must never fabricate, and how PLACES's particular caveats — model-based estimates, 95%
intervals, two value types, per-measure data years, suppression — become first-class envelope
data. Everything marked *verified* was checked live on 2026-09-20.

## What PLACES is, verified

- **Source and access.** Socrata SODA on `data.cdc.gov` (`/resource/<id>.json?…`), JSON rows, no
  key required. Without an application token, requests share a per-IP pool that "may be subject
  to throttling"; with a free token (`X-App-Token` header) Socrata does "not throttle API
  requests … unless … abusive". So: optional `SOCRATA_APP_TOKEN`, sent as a header, never logged.
- **Licence.** The datasets declare **Public Domain**; attribution "Centers for Disease Control
  and Prevention, National Center for Chronic Disease Prevention and Health Promotion, Division of
  Population Health"; contact `places@cdc.gov`. PLACES is "a partnership between CDC, the Robert
  Wood Johnson Foundation, and the CDC Foundation."
- **Releases.** Annual; the **2025 release** (rows updated 2025-12-04) is current, one dataset per
  level: county `swc5-untb` (229,298 rows), place `eav7-hnsx` (2,150,438), census tract
  `cwsq-ngmh` (3,047,284), ZCTA `qnzd-25i4` (1,171,563). Earlier releases (2020–2024) keep their
  own ids. **No state and no metro level** — PLACES starts at the county.
- **Identifiers.** `locationid` is the Census GEOID at every level — county `08031`, place
  `0820000`, tract `08031010900`, ZCTA `80202` — exactly the catalog's geoids, so a resolved
  place addresses PLACES directly (`?locationid=<geoid>`). The county file carries no
  `countyfips` column (the 2025 place and ZCTA files carry none either; tract carries it).
- **Measures.** 40 in seven categories (verified list): Health Outcomes (12: arthritis, high
  blood pressure, cancer, asthma, coronary heart disease, COPD, depression, diabetes, high
  cholesterol, obesity, stroke, all teeth lost), Prevention (7: no insurance 18–64, BP medication,
  routine checkup, cholesterol screening, colorectal screening, dental visit, mammography),
  Disability (7), Health-Related Social Needs (7: emotional support, food insecurity, food stamps,
  housing insecurity, transportation, loneliness, utility shut-off), Health Risk Behaviors (4:
  binge drinking, smoking, no leisure physical activity, short sleep), Health Status (3: fair/poor
  health, frequent mental distress, frequent physical distress). The nine "non-medical factors"
  PLACES also shows are ACS variables the Census server already serves — not PLACES estimates.
- **Value shape.** Every measure comes as **two rows per place: `Crude prevalence` and
  `Age-adjusted prevalence`** (percent of adults ≥18), each with `low_confidence_limit` /
  `high_confidence_limit` (a **95% interval** from 1,000 Monte Carlo draws of the multilevel
  regression and poststratification model), plus `totalpopulation` and `totalpop18plus`.
  Denver city obesity 2023: crude 21.6 (18.6–24.7), age-adjusted 21.8 (18.8–25.0).
- **Data year ≠ release year.** Within the 2025 release, 35 measures carry `year 2023` and five
  carry `year 2022` (colorectal screening, dental visit, mammography, short sleep, teeth lost —
  BRFSS rotating-core questions). The vintage is per measure, not per release.
- **Suppression.** `data_value` is null with `data_value_footnote_symbol "*"` and the footnote
  "Estimates suppressed for population less than 50" (66 county rows in 2025); symbol `#` notes
  "The estimates are based on 39 states and DC" (14 rows). Places exist only with 50+ adults.
- **Method caveat.** Estimates are model-based ("multilevel regression and poststratification"
  over BRFSS, ACS county poverty and decennial counts), not direct survey results; CDC's validation
  reports "strong/moderate correlations" with direct estimates. They are appropriate for
  ranking and screening local need, and the intervals must travel with them.

## What M9 builds

- **`server-cdc-places`** on the core shell, agency prefix `places_`: `places_resolve_place`,
  `places_get_indicator`, `places_compare_places`, `places_list_indicators`, `places_get_raw`,
  `places_describe_source`.
- **A SODA fetch capability** on the registry seam: one query per (level dataset, locationid,
  measure) returning both value types; observations carry the value, its 95% interval, the value
  type, the data year, the adult population, and suppression as null + the CDC footnote.
- The intervals and the method as envelope data, the way margins of error are for Census.

## The decisions (numbered; recommendations given)

### 1. Vocabulary: all forty measures
(a) all forty as indicators, named from `measureid` (`obesity`, `diabetes`, `depression`,
`current_smoking`, `binge_drinking`, `no_health_insurance_18_64`, `routine_checkup`, …) with
their CDC labels and categories in `list_indicators`; (b) a curated dozen; (c) whole tables via
raw only. **Recommendation: (a)** — the set is small, fixed and well-named, and category is what
a user browses by; the nine ACS factors are excluded (the Census server owns them).

### 2. Value type as a dimension, age-adjusted by default
Both rows arrive in one query. **Recommendation:** a new dimension argument `adjustment` on the
core seam (`adjusted` = age-adjusted, default; `crude`), the answer carrying the other type as a
footnote. Age-adjusted is what PLACES itself leads with and what makes places comparable; crude is
the "how many people here" number and one argument away.

### 3. Intervals travel with every value
**Recommendation:** `SeriesObservation` gains an optional `interval: { low, high, level: 0.95 }`
(generic; Census could carry a symmetric one later); `places_get_indicator` reports it in `data`
and `compare_places` rows carry it; a footnote flags a wide interval (width > 10 percentage
points) as "imprecise". No coefficient-of-variation grade — intervals are asymmetric and the
interval itself is the reliability statement.

### 4. Method, vintage and suppression as first-class caveats
**Recommendation:** every answer carries the limitation "model-based small-area estimate (CDC
PLACES 2025 release), not a direct survey result"; the observation's `year` is the measure's data
year and `periodName` names the release; a suppressed cell is `value: null` with the CDC footnote
verbatim; the `#` footnote passes through. Cross-release trend comparison is out of scope (only the
current release is served; older releases via `places_get_raw`).

### 5. Geography: county, place, tract, ZCTA; no state or metro; no fallback
**Recommendation:** `agencyCodeOf` returns the geoid for sumlevels 050/160/140/860 (the dataset
is chosen by level) and undefined otherwise. A state or metro is **unavailable** with the
limitation "PLACES publishes county, place, tract and ZCTA estimates only; state figures come from
BRFSS directly" — no aggregation, no fabrication. Unlike LAUS there is no threshold: a 9,777-person
Sedona has its own row, so no county fallback; a place under 50 adults is absent and reported as
unavailable.

### 6. Compare: one measure, one value type, one data year
**Recommendation:** ≤20 places, aligned on the measure's data year (identical within a release),
rows carrying value and interval; a note when intervals overlap is deferred with significance
testing (as for Census).

### 7. `places_get_raw`: SODA passthrough within the PLACES datasets
**Recommendation:** `{ dataset: county|place|tract|zcta, release?: 2020–2025, select?, where?,
order?, limit? }` mapped to `$select/$where/$order/$limit` on the release's dataset id table;
rows returned unchanged; the dataset id as the source id. A whitelist of the four datasets per
release, not arbitrary Socrata ids.

### 8. Token, quota, cache, fixtures
**Recommendation:** all calls through the core client; optional `SOCRATA_APP_TOKEN` as the
`X-App-Token` header (a sensitive Terraform variable when set; the server runs without it);
30-day cache (a release is immutable); recorded fixtures for Denver County, Denver city, Sedona,
a suppressed tiny place and a `#`-footnoted row; live smoke under `LIVE_TESTS=1` only.

### 9. Scope and version
M9 = `packages/server-cdc-places`, its Terraform module and instance (`places-mcp.responsive.city`),
the SODA capability, the forty indicators with the `adjustment` dimension, compare and raw, evals,
docs; ships as **v0.4.0**. Out: older releases through the indicator tools, the nine ACS factors,
significance testing, state/metro aggregation, the composite endpoint.

## Proposed build-issue cut (from the rulings, not before)

1. **M9.1 Package + shell + Terraform** — `server-cdc-places` on the core (definition,
   `places_resolve_place`, `describe_source` with the seven categories planned, public-domain
   attribution), module/instance/fleet fields/deploy/admin-role, optional token plumbing.
2. **M9.2 SODA fetch capability** — dataset-id table per release/level, query builder, row parser
   (both value types, interval, year, populations, footnotes), `interval` on the observation type,
   `adjustment` dimension argument on the core seam; recorded fixtures.
3. **M9.3 Forty indicators** — definitions from a verified measure table (id, label, category,
   data year), `list_indicators` grouped by category, the method/vintage limitations.
4. **M9.4 Compare + raw** — alignment on data year with intervals per row; the SODA passthrough.
5. **M9.5 Reconcile, evals, deploy, v0.4.0** — docs, connect quickstart, eval cases (county
   obesity with interval, a city vs its county, a tract, a suppressed place, a state → unavailable,
   an ambiguity stop, describe_source), deploy, tag.

Order: 9.1 → 9.2 → 9.3 → 9.4 → 9.5 (9.3 and 9.4 can run in parallel once 9.2 lands).

## Out of scope for this spike

Anything beyond the current release's four datasets; the composite endpoint; HUD/BEA/FEMA.

# ADR-010: M4 wages, prices, openings — CES, OEWS, CPI, JOLTS over a program registry

**Status:** accepted (2026-09-10) ·
**Spike:** [`m4-wages-prices-openings`](../spikes/m4-wages-prices-openings.md) ·
**Affects:** `packages/server-bls`, `packages/core` (HTTP client generalization), `docs/architecture.md`

## Context

M3 shipped the first real statistic by place (LAUS unemployment) over the family verbs, live end to
end (ADR-009). M4 adds the next four BLS programs — Current Employment Statistics State & Area
(**CES S&A / SM**, payroll employment), Occupational Employment and Wage Statistics (**OEWS / OE**,
wages by occupation), the Consumer Price Index (**CPI / CU**, prices), and the Job Openings and
Labor Turnover Survey (**JOLTS / JT**, openings/hires/quits/layoffs) — plus the `bls_compare_places`
family verb. All four publish through the same BLS timeseries API M3 uses; QCEW (its own CSV client)
stays in M5. This ADR records the M4 rulings (owner, 2026-09-10); build issues are cut from it.

## Decisions

1. **Program dispatch: a flat indicator vocabulary over a registry, program hidden.**
   `bls_get_indicator` is generalized from its LAUS-hardcoded path to a **registry** in
   `server-bls` mapping each indicator to `{ program, buildSeriesId, agencyCodeOf, defaults }`. The
   model names an `indicator` (`unemployment_rate`, `payroll_employment`, `occupational_wage`,
   `cpi_all_items`, `job_openings`, …); the MCP owns indicator → program → series-id, so API shape
   never leaks (ADR-009 §1). No `program` argument. `bls_list_indicators` is the discovery surface.
   The family-verb dispatch stays generic; the vocabulary is agency-specific and lives in server-bls.

2. **Dimension depth: headline series in M4, sub-dimension pickers deferred.** M4 ships the headline
   series per program — total nonfarm (CES), all-items (CPI), all-occupations mean + median annual
   wage plus employment (OEWS), total openings/hires/quits/layoffs (JOLTS). SOC occupation, NAICS
   supersector/industry and CPI item pickers are **deferred** to a later milestone; the registry
   leaves room for a dimension argument without reshaping the tool.

3. **`bls_compare_places`: one indicator × N places, aligned on the latest common period.** Input is
   one `indicator` and a list of `places` (resolved through the same resolver, with the same
   below-coverage fallbacks as `get_indicator`); output is one row per place, aligned on the latest
   period all places share, each row carrying value, footnotes and the resolved place. The list is
   capped at **≤ 20 places** and batched through the BLS 50-series/query limit. A place that falls
   back (e.g. below-threshold city → county) is labelled in its row, never dropped.

4. **CPI geography: nearest published area, explicit "no local CPI", never fabricated.** CPI
   publishes only for the U.S. city average, census regions and divisions, and ~23 named metros. A
   **hand-maintained CPI-area map** (data, in the spirit of ADR-008's code tables) maps a resolved
   place to its containing published CPI geography. A CPI indicator returns that nearest published
   geography's value with an explicit caveat ("CPI is not published for <place>; showing
   <published area>") — mirroring the LAUS below-threshold county fallback (ADR-009 §6). Never a
   fabricated or interpolated local index.

5. **Seasonal adjustment and period: inherit ADR-009, with per-program defaults.** ADR-009 §4–§5
   (NSA below state; latest ~13 months by default, range on request) is inherited, with a per-program
   default recorded in the registry: OEWS returns the latest **annual** figure (no seasonality); CPI
   defaults NSA with `seasonallyAdjusted` honored where published; CES defaults NSA below state with
   SA on request where published; JOLTS returns the state NSA series. A requested adjustment that is
   not published returns the available series with an explicit note, never an error.

6. **Data source: the BLS timeseries API, reusing the core client.** All four programs fetch from
   `api.bls.gov/publicAPI/v2/timeseries/data` through the core HTTP client (retry/backoff, budget
   counter, two-tier cache, ≤50-series batching, fixtures; #5). `fetchLausBatches` is generalized to
   a program-agnostic `fetchSeriesBatches`. QCEW's CSV slice client stays out of M4 (M5).

7. **Coverage and discovery: flip availability, list across programs.** As each program lands it is
   flipped `planned → available` in `bls_describe_source` (as #84 did for LAUS), and
   `bls_list_indicators` names every registered indicator and, given a place, which programs publish
   at its level (the resolver's `publishes_at`). The architecture doc's M4 row is reconciled in the
   same PRs (docs describe what is).

8. **Scope: CES/OEWS/CPI/JOLTS headline + compare_places in M4.** Out of scope: occupation/industry/
   item pickers (later), QCEW's CSV client (M5), the LABSTAT hosted mirror (#51), and any
   non-timeseries-API program.

## Consequences

- The **program registry** (Decision 1) is the load-bearing seam: it is built first, LAUS is migrated
  onto it with no behaviour change, and every later BLS program (M5 QCEW included, via its own fetch
  path) registers an indicator rather than growing a new tool.
- Four programs flip to `available`; the four caveat patterns (headline default, CPI "no local CPI",
  per-program seasonal defaults, footnote flags) all reuse the M3 envelope.
- `bls_compare_places` completes the family verb set for BLS.
- The 500/day cap remains a known limit (ADR-009); #51 removes it if the added programs make it bite.

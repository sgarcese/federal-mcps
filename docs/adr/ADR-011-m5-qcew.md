# ADR-011: M5 QCEW — the first non-timeseries program, over a registry fetch capability

**Status:** accepted (2026-09-16) ·
**Spike:** [`m5-qcew`](../spikes/m5-qcew.md) ·
**Affects:** `packages/server-bls`, `packages/core` (HTTP client use), `docs/architecture.md`

## Context

M1–M4 delivered five BLS programs (LAUS, CES, OEWS, CPI, JOLTS) behind the family verbs, all on the
BLS Public Data **timeseries API** through the program registry (ADR-010 §1). M5 adds the
**Quarterly Census of Employment and Wages (QCEW)** — covered employment and wages by industry and
ownership. QCEW is the first program that does **not** use the timeseries API: it is distributed as
**CSV area slices** (`data.bls.gov/cew/data/api/{year}/{qtr}/area/{area}.csv`) with **no series
id** — a value is selected from an area's slice by ownership, industry and aggregation level. This
ADR records the M5 rulings (owner, 2026-09-16); build issues are cut from it.

## Decisions

1. **Data path: a CSV area-slice client through the core HTTP client.** QCEW slices are fetched with
   the core client's `getText` (retry/backoff, cache), parsed, and the headline row selected. QCEW's
   open API has **no 500/day cap**, so it does not consume the timeseries budget; a **long-TTL
   cache** keyed by `(area, year, quarter)` fits data fixed once released. No direct `fetch`
   (CLAUDE.md) — the shared client only.

2. **Registry fetch capability — QCEW stays behind the family verbs.** `IndicatorDefinition` is
   generalized to supply a **fetch capability** (`fetch(place, options) → observations`) rather than
   only a series-id builder. The five timeseries programs share the default capability (resolve
   agency code → build series id → timeseries fetch, migrated with no behaviour change); QCEW
   provides a CSV capability. QCEW is therefore reached through `bls_get_indicator` (never a
   program-named tool, ADR-010 §1), and `bls_compare_places` / `bls_get_raw` work for it for free.
   This is the M5 analog of M4.1's registry seam.

3. **Geography: county and state in M5, MSA deferred.** County (`SSCCC`) and state (`SS000`) QCEW
   area codes derive mechanically from the resolved place's GEOID — no catalog column. The MSA code
   (`C1974`) is QCEW-specific and **not** a clean CBSA derivation, so it is deferred to a follow-up
   that stores the QCEW `C`-code as a catalog column at build time (mirroring the CES metro key,
   #110). U.S.-total (`US000`) is a cheap optional add.

4. **Headline measures: covered employment and average weekly wage.** M5 ships the **total-covered,
   all-industries** headline (`own_code 0`, `industry_code 10`) as two indicators:
   **`covered_employment`** and **`average_weekly_wage`**. `covered_employment` is deliberately named
   apart from LAUS's `employment` (a different concept). NAICS-industry, ownership and size pickers,
   and the location-quotient / over-the-year-change columns, are deferred — the "headline first,
   pickers later" call M4 made (ADR-010 §2).

5. **Suppression: disclosure codes are caveats, never dropped.** A cell withheld for confidentiality
   (`disclosure_code`) returns a **null value with an explicit disclosure caveat** in the envelope
   (the QCEW code mapped to plain language), never a dropped or fabricated number — the same
   discipline as the timeseries footnote flags (ADR-009 §7).

6. **Vintage: latest published quarter by default.** QCEW is quarterly (with an annual-average
   release) and lags ~5–6 months. M5 defaults to the **latest published quarter** (determined from
   the expected lag, or a small probe), returns the quarter fetched as the vintage, and accepts an
   explicit `year`/`quarter`. Annual-average mode is a later add.

## Consequences

- The **fetch-capability generalization** (Decision 2) is the load-bearing seam: it is built first,
  the five timeseries programs migrate onto the default capability with no behaviour change, and any
  future non-timeseries source (QCEW now) plugs in a capability rather than a new tool.
- QCEW flips to `available` in `bls_describe_source`; the six BLS programs are then all served, with
  only sub-dimension pickers and QCEW MSA outstanding.
- The LABSTAT hosted mirror (#51) stays orthogonal — it addresses the timeseries programs' 500/day
  cap, which QCEW does not share.

## Scope

M5 = QCEW **county + state**, **total-covered all-industries**, **`covered_employment` +
`average_weekly_wage`**, behind `bls_get_indicator` and `bls_compare_places`, with disclosure
caveats. Out: QCEW MSA (its `C`-code catalog mapping — a follow-up), NAICS/ownership/size pickers,
LQ and over-the-year columns, annual-average mode, and the LABSTAT mirror (#51).

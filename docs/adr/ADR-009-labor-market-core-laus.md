# ADR-009: M3 labor market core — LAUS data tools over the family verbs

**Status:** accepted (2026-09-09) ·
**Spike:** [`m3-labor-market-core`](../spikes/m3-labor-market-core.md) ·
**Affects:** `packages/server-bls`, `packages/core` (HTTP client use), `docs/architecture.md`

## Context

M3 ships the first tool that returns a real statistic by place: BLS Local Area Unemployment
Statistics (LAUS) — unemployment rate, unemployment level, employment, labor force. It builds
on the M2 resolver, which already maps a place to its GEOID, summary level, LAUS area code and
structured flags. This ADR records the M3 rulings; build issues are cut from it.

## Decisions

1. **Family verbs, not program-named tools.** M3 exposes `bls_get_indicator`
   (with a `measure` argument), `bls_list_indicators` and `bls_get_raw`; `bls_resolve_place`
   and `bls_describe_source` already exist. The model triggers a verb; the MCP owns the
   verb→series-id→endpoint mapping, so API shape never leaks to the model. `docs/architecture.md`'s
   program-named sketch (`bls_get_unemployment`) is superseded and reconciled in the M3 build.

2. **BLS Public Data timeseries API for the MVP.** LAUS observations are fetched from
   `api.bls.gov/publicAPI/v2/timeseries/data` (keyed via `BLS_API_KEY`, ADR-006) through the
   core HTTP client (retry/backoff, timeout, budget counter, two-tier cache; #5), batching up
   to 50 series/query. The 500/day cap is managed by caching and batching. The **LABSTAT
   hosted mirror is deferred to spike #51** — BLS hosts the raw flat files free and uncapped;
   the mirror is our own replication into an S3/DuckDB store, built only if the cap bites.

3. **Series ids are built, not typed.** A pure `(area, measure, seasonal) → LAUS series id`
   builder, unit-tested against known-good published ids. A typed measure vocabulary
   (`unemployment_rate`, `unemployment`, `employment`, `labor_force`) maps to LAUS measure codes.

4. **Seasonal adjustment defaults to not-adjusted below state.** LAUS publishes seasonally
   adjusted series only for states and a few large areas. The tools default to `U` (not
   adjusted) at sub-state levels, expose a flag to request adjustment, and return the `U`
   series with an explicit note where adjustment is not published (never an error).

5. **Period: latest by default, range on request.** Default to the latest ~13 months; accept
   an explicit `startYear`/`endYear`. Each observation carries its period and footnote codes.

6. **Below-threshold returns the county, explicitly flagged.** For a city under the LAUS
   25,000 threshold (`below_threshold`), `get_indicator` returns the surrounding county's value
   with an explicit caveat ("covers <county>, not just <place>") and the county's place block —
   never a silent substitution or a fabricated city number. This caveat behaviour is the
   product's core value (UGEO-Bench findings).

7. **Numbers carry their caveats.** The envelope returns the value(s) with each period's
   footnote codes mapped to plain language (P = preliminary, R = revised), the vintage, the
   resolved place, the LAUS series id and a citation. `bls_get_raw` returns the unprocessed
   BLS response for trust and debugging.

8. **Scope: LAUS only in M3.** CES State & Area, OEWS, CPI and JOLTS are M4; QCEW (its own CSV
   client) is M5; `compare_places` is a later thin wrapper over `get_indicator`.

## Consequences

- LAUS flips from `planned` to `available` in `bls_describe_source`.
- The patterns set here (builder, cached fetch, number envelope, caveat behaviour) are the
  template every later BLS program reuses.
- The 500/day cap is a known limit accepted for the MVP; #51 removes it if needed.
- `docs/architecture.md`'s BLS tool table is updated to the family verbs in the M3 build.

## Alternatives rejected

- **Program-named tools** (`bls_get_unemployment`): breaks the family-verb contract the
  harness enforces and pushes API structure toward the model.
- **LABSTAT mirror first**: larger build, and premature — the API + cache covers interactive
  use, and the mirror (#51) is a clean fast-follow if the cap becomes a real constraint.
- **Silent county fallback for below-threshold places**: the exact failure UGEO-Bench catches;
  the caveat must be explicit.

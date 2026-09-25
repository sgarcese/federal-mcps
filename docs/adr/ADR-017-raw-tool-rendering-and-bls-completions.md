# ADR-017: Compact text for raw tools; the M12 BLS completions

**Status:** accepted (2026-09-24) ·
**Context:** the South Bend field report (#210–#214), epic #221 ·
**Affects:** `packages/core/src/server` (rendering, `ToolDefinition`), `packages/core/src/testing`
(a contract rule), `census_get_raw`, `bls_get_raw`, the QCEW indicators

## Context

Every tool result carries two forms: `structuredContent` (the whole envelope, never cut) and a
text rendering for hosts that read only text, cut at 4,000 characters of JSON (#6). For indicator
tools that is ample. For raw tools the rows *are* the answer. A plugin session building a housing
dashboard found that a `census_get_raw` pull of five variables for every Indiana county (5,010
characters of rows) was cut, and that the variable list was printed three times before the first
row (the provenance line, `query.ids`, `header`), so only three or four places fit per call. A
nine-series BLS pull (81,742 characters) also ran into the host's own cap on a tool result. None
of this comes from BLS or Census: their limits are per request (series, years, variables), not
per character, and a data mirror (#51) would not change it.

## Decision (owner rulings, 2026-09-24)

1. **Raw tools render a compact table.** A tool may declare `renderData(data)` returning
   `{ head, items, unit, narrowHint }`: lines printed once (a column header, API notes), then one
   entry per row or series. With a compact rendering the provenance line omits the id list, so
   ids appear once. `census_get_raw` renders a CSV header and one CSV line per row;
   `bls_get_raw` renders one block per series (an id line, then `year,period,value,footnotes`).
2. **Budgets.** Raw tools carry `textBudget = RAW_TEXT_BUDGET` (24,000 characters, about 6,000
   tokens — under common host caps). Indicator tools keep 4,000. The shell cuts on whole items and
   ends with "showing N of M <unit>; the whole value is in structuredContent." plus the tool's
   `narrowHint`; a single item larger than the budget shows its start, marked partial.
3. **Enforced.** A new contract rule, `raw-rendering`, fails any `*_get_raw` tool that declares no
   renderer or budget. Tool descriptions state the budget and the batching advice.
4. **QCEW history (#213)** is served at most five years of quarters per call, with a
   `frequency: quarterly|annual` dimension (annual averages from the annual area files).
5. **Build order (epic #221):** #210, #211, #212 (per-definition source URL on the indicator
   seam), #214, #213; shipped as v0.5.0.

## Consequences

- The Indiana county pull above renders all 92 rows in 3,019 characters (was cut at 4,267).
- A wide BLS pull still hits the host cap if it asks for many long series at once; the tool now
  says so and how to narrow, rather than returning a silent JSON fragment.
- `structuredContent` is unchanged; hosts that read it see no difference.
- Future raw tools (HUD User, M11) get the rule for free.

## Alternatives rejected

- **Raise the global budget.** Indicator answers would bloat model context for no gain, and the
  repeated id lists would still waste the budget.
- **Mirror BLS.** Solves quota, not rendering (see Context).

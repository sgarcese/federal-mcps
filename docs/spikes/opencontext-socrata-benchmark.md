# Spike: geo resolver + OpenContext Socrata connector as a reusable pattern (CDC PLACES benchmark)

**Question.** CDC PLACES lives on a Socrata portal. Instead of building `server-cdc-places`
(the M9 spike), can the family's geography resolver (`geo-mcp`) plus a generic
[OpenContext](https://github.com/thealphacubicle/OpenContext) Socrata connector pointed at
`data.cdc.gov` give a policy analyst the same accuracy — and is that a **reusable pattern** for
every Socrata/CKAN/ArcGIS-hosted federal source, so that a dedicated server is only built where
an API has a grammar (BLS series ids, Census variables) rather than a query language?

**Method (2026-09-20).** OpenContext `main` (fcd1549) run locally with its Socrata plugin on
`https://data.cdc.gov` (SODA3 `query.json`; data.cdc.gov accepts untokened requests, so the
`X-App-Token` header was dropped by a local wrapper — no source change). A fresh Claude Sonnet
agent got only two endpoints — `geo_resolve_place` live and the six `socrata__*` tools — and
seven questions, with the instruction to cite tool results only. Ground truth was pulled
directly from SODA beforehand. Two runs: **naive** (tools only) and **guided** (tools plus a
250-word "source guide" for PLACES: which dataset ids, query by `locationid`, value types,
per-measure data year, suppression footnote, no state level, no aggregation, ambiguity rule).

## Results

| # | Question | Ground truth | Naive | Guided |
|---|---|---|---|---|
| 1 | Denver County obesity, with confidence | 21.6 age-adj (18.4–25.2); crude 21.6 (18.4–25.1); 2023 | pass — crude led, interval given | pass — age-adjusted led, both types |
| 2 | Denver city vs county diabetes | age-adj 8.0 (7.1–9.0) vs 7.8 (6.7–9.0) | pass — compared crude (7.1 vs 7.1) | pass — age-adjusted, overlap stated |
| 3 | Highest-smoking tract in Denver County | 08031000800, 26.8 (23.7–29.9) | pass | pass |
| 4 | Loving County TX obesity (suppressed) | null; "Estimates suppressed for population less than 50" | **partial** — "not published" but claimed the county is *absent* and guessed the reason; the CDC footnote never surfaced | pass — footnote verbatim |
| 5 | Colorado statewide obesity from PLACES | not published; no state level | **fail** — correctly said no state file, then **population-weighted 64 counties into "≈26.2%"** and cited it | pass — refused to aggregate, named BRFSS |
| 6 | Obesity in "Springfield" | ambiguous; ask the state | pass (agent's own judgment; tool said `ok`) | pass |
| 7 | Latest colorectal screening, Denver County | 59.0 age-adj / 61.7 crude, **2022** data year | pass — 2022 found via the dataset description | pass |
| | Tool calls | | 19 | 12 |

Naive: 5 clean, 1 partial, 1 fail. Guided: 7 of 7.

## What the failures were

Both naive misses are the class the family exists to prevent, and neither was a data-access
problem.

- **Dataset selection.** `search_datasets` ranks the "GIS Friendly Format" wide files
  (`i46a-9kgh`, `vgc8-iyc4`, `yjkw-uj5s`) above the long files for two of three natural queries,
  and the 2020 release second for one. The wide file **omits suppressed counties entirely**
  (Texas has 253 rows, not 254) and carries no footnotes — so Loving County looked "absent" and
  the agent invented a mechanism. The long file has the row, the null, and the CDC footnote.
- **Policy, not data.** The naive agent knew there was no state level and aggregated anyway,
  labelling it "my own aggregation". A policy analyst quoting that gets a number CDC never
  published. The family rule "never fabricate a level the agency does not publish" is a rule
  the tool has to enforce or the guide has to state; the data cannot.
- **Defaults.** Nothing tells a naive agent which of the two value types to lead with; it chose
  crude and compared crude. Both are correct numbers; only one is the comparable one.

What worked without any help: the geoid from `geo_resolve_place` is the `locationid` at every
level, so resolve-then-query needed no crosswalk; the SODA rows carry the interval, the year and
the footnote, so a careful agent can find every caveat; and `get_dataset` returns CDC's
description, which is where the naive agent found the 2022-vs-2023 data-year fact.

## Verified facts that correct the M9 spike

- **Suppression exists only in the county file** (66 `*` rows, 14 `#` rows). The 2025 place,
  tract and ZCTA files have no suppressed rows and no null values: places under 50 adults are
  simply absent (smallest present: 50 adults).
- **Age-adjusted prevalence is published only at county and place.** Tract and ZCTA files carry
  crude prevalence only (3,047,284 and 1,171,563 rows, one type). An `adjustment` dimension
  would have to be county/place-only.
- The county file carries a national row (`locationid` 59, `stateabbr` US); still no state rows.

## Findings for the family

1. **The pattern is reusable and cheap: geo resolver + generic portal connector + a source
   guide.** With a short written guide the generic connector matched the ground truth on every
   case, including the three "family" cases (suppression, no-state-level, data year). The guide
   is ~250 words per source and is exactly the content a dedicated server encodes in
   `describe_source`, `list_indicators` descriptions and instructions.
2. **Without the guide, expect one policy violation per session on a source like PLACES.** The
   rows are all there; the model's discipline is not. That is the argument for either a guide
   the host loads, or a server that makes the wrong query impossible.
3. **Where a dedicated server still earns its cost:** an API with a *grammar* (BLS series ids,
   Census variable/geography strings, OEWS/QCEW code tables), quota/caching discipline the
   connector lacks, or a contract suite the host relies on. PLACES has none of these: SoQL is
   the grammar and a release is immutable.
4. **OpenContext gaps met on the way:** the Socrata plugin requires an app token even for
   portals that serve untokened (a config-only fix upstream: allow empty and omit the header);
   search ranking favours wide GIS files; `get_schema` on the place file shows `placename`
   holding the FIPS code, not the name (upstream data quirk, worth a note in the guide).
5. **Geo gap:** `geo_resolve_place` returned `status: "ok"` for ten same-name Springfields in
   ten states (the ambiguity stop is by *kind*, not by state) — filed as #187.

## Decisions for the owner

1. **CDC PLACES: defer the server; ship the guide.** Recommendation: no `server-cdc-places`
   for now. Publish the PLACES source guide (the guided-run text, plus dataset ids per release
   and the corrections above) as `docs/guides/cdc-places.md`, usable as connector instructions
   or a host prompt alongside `geo-mcp` and an OpenContext Socrata deployment on `data.cdc.gov`.
   Revisit a server only if usage shows analysts hitting the no-guide failure modes.
2. **Where the guide lives at runtime.** (a) OpenContext's `description`/instructions field on a
   per-source deployment (needs an upstream contribution to surface instructions to hosts);
   (b) the family's composite/geo server instructions carrying a per-source section;
   (c) a docs page the analyst pastes. Recommendation: (a) upstream, (c) meanwhile.
3. **Generalise the pattern.** Treat "guide + connector" as the default for every portal-hosted
   source in the roadmap (HUD on ArcGIS, FEMA on OpenFEMA, CDC WONDER excluded — it has no
   portal API) and "server" as the exception justified by a grammar or quota. Recommendation:
   record this in an ADR (ADR-015) that amends ADR-001's "one server per agency".
4. **Fix #187** so the resolver stops on same-name-across-states; it is the one family-side gap
   the benchmark found.

## Artifacts

Runs and ground truth were scratch (not committed); ground-truth queries are reproducible from
the M9 spike's dataset ids. OpenContext was run from a local checkout; nothing was pushed.

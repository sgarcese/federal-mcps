# ADR-014: M8 Census server — ACS headline indicators with reliability as first-class data

**Status:** accepted (2026-09-19) ·
**Spikes:** [`census-server-suitability`](../spikes/census-server-suitability.md),
[`m8-census`](../spikes/m8-census.md) ·
**Affects:** new `packages/server-census`, `packages/core` (registry seam reuse, catalog
population column), `packages/geography-build`, `terraform/` (new module and instance),
`docs/architecture.md`

## Context

Release 1 (M1–M7) delivered the BLS server on the shared core. ADR-001 planned Census as the second
agency server by adapting the official `uscensusbureau/us-census-bureau-data-api-mcp`. The
suitability spike (rulings 2026-09-18) reversed that: upstream went quiet in 2026-03, is
Postgres/Docker/stdio-bound, returns free text with no caveats, and duplicates the geography the
catalog carries; `server-census` is built on the core and borrows upstream's table index and query
grammar as data. The M8 spike verified the Census Data API on 2026-09-18: a key is now mandatory
for every data query; ACS 1-year and 5-year run through 2024; 1-year covers only areas of 65,000+;
`ucgid=` accepts the catalog's identifiers; every estimate carries a margin of error and annotation
sentinels. This ADR records the owner's rulings (2026-09-19) on the eleven decisions; build issues
are cut from it.

## Decisions

1. **Vocabulary: thirteen ACS headline indicators plus decennial population.** Total population,
   median age, median household income, per capita income, poverty rate, unemployment rate (ACS),
   bachelor's degree or higher, uninsured share, mean travel time to work, median gross rent,
   median home value, owner-occupied share, median monthly housing cost — each one verified ACS
   variable from the detailed, subject or profile endpoint — and `decennial_population`
   (2020 `dec/pl` P1_001N, no margin of error). Sub-dimension pickers are a later milestone on the
   existing dimension seam.

2. **Product by population, always named and flagged.** The ACS capability requests the 1-year
   product when the place's population is ≥ 65,000 and the 5-year product otherwise, reading the
   population from a catalog column (decision 6). Every answer states the product, its period
   ("2024" or "2020–2024") and the reason. A `product` argument overrides; a 1-year request below
   the threshold is answered with the 5-year figure and a caveat, never an empty result. Tracts and
   ZCTAs are 5-year only.

3. **Margins of error and reliability grades travel with every value.** Each observation carries
   `value`, `marginOfError` (90% confidence) and `reliability` from the coefficient of variation
   (MOE / 1.645 / estimate): `high` below 12%, `medium` 12–40%, `low` above 40%; a low grade adds
   a limitation. Percent indicators carry the margin in percentage points.

4. **Annotation sentinels are null plus a caveat, never a number.** The `EA`/`MA` columns are
   always requested; `-666666666`, `-999999999`, `-888888888`, `-222222222`, `-333333333` and
   `null` map to `value: null` with the Census meaning as the caveat; an open-ended median returns
   the bound with a caveat; `-555555555` returns the value with `marginOfError: null` and the note
   that the estimate is controlled.

5. **`census_compare_places` aligns on one product.** When the compared places mix sizes, the
   comparison uses the 5-year product for all and says so; rows carry each place's margin of
   error. Significance testing is deferred.

6. **Geography from the core catalog, plus a population column.** `census_resolve_place` is
   core's resolver. `geography-build` adds each entity's ACS 5-year total population so decision 2
   needs no runtime call. County subdivisions are added when a story needs them.

7. **Discovery through a vendored table index.** `census_search_tables` searches a compact index
   (table id, label, endpoint, years) derived by a script from the official server's seed configs
   and `data.json`, vendored gzipped and searched with FTS — no runtime database, no network at
   query time. It returns table ids for `census_get_raw`.

8. **`census_get_raw` carries the official server's query grammar** (`dataset`, `year`,
   `get.variables` | `get.group`, `for` | `in` | `ucgid`, `predicates`, `descriptive`), validated
   the same way, through the core client; the envelope wraps the API's rows with the query as the
   source id.

9. **Quota, cache, fixtures.** All calls through the core client with the key (`CENSUS_API_KEY`,
   a sensitive Terraform variable → Lambda env var, ADR-006); long-TTL cache keyed by (dataset,
   vintage, variables, ucgid); recorded fixtures for every indicator; live smoke under
   `LIVE_TESTS=1` only; no mirror.

10. **Other datasets.** Decennial population ships in M8; SAIPE and `pep/charv` are deferred with
    a note in `describe_source`; PEP's API series ends at 2021 and is not used.

11. **Scope and version.** M8 = `packages/server-census`, its Terraform module and instance
    (`census-mcp.responsive.city`), the ACS capability, the vocabulary, reliability rules, table
    search, raw grammar, evals and docs; **v0.3.0**. Out: pickers, county subdivisions,
    significance testing, SAIPE/PEP, the composite endpoint. The Census API's required sentence
    ("This product uses the Census Bureau Data API but is not endorsed or certified by the Census
    Bureau.") is displayed in `census_describe_source`, the README and the connector docs.

## Consequences

- The registry seam (ADR-010/011/013) serves a second agency unchanged: an ACS fetch capability
  and per-indicator definitions, with dimensions available for a later picker milestone.
- Reliability becomes envelope data, not prose: a model can say "median income is $73,738 ± $12,737
  (medium reliability, 2020–2024 five-year)" for a town of 9,777 and "$92,504 ± $3,897 (2024
  one-year)" for a city of 729,019, and never a bare number for either.
- The catalog gains a population column every later server can use for coverage rules.

## Scope

M8.1 package + shell + key · M8.2 ACS capability + reliability seam · M8.3 catalog population ·
M8.4 indicators · M8.5 compare + raw · M8.6 table index + search · M8.7 reconcile, evals, deploy,
v0.3.0. Order: 8.1 → 8.2 ∥ 8.3 → 8.4 → 8.5 ∥ 8.6 → 8.7.

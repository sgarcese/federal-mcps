# Spike: M8 — the Census server (ACS headline indicators with reliability as first-class data)

The family's second agency server. The suitability spike (2026-09-18, rulings accepted) settled
the base: **build `server-census` on the core**, the way `server-bls` was built, and borrow the
official Census MCP server's dataset index and query grammar as data. This spike settles what the
server answers, what it must never fabricate, and how the family contract applies. Everything
below marked *verified* was checked against the live Census Data API metadata on 2026-09-18.

## What the Census Data API is, verified

- **A key is now mandatory.** Every data query without a key (`for`, `in` or `ucgid` forms alike)
  redirects to a "Missing Key" page; only metadata (`variables.json`, `geography.json`,
  `data.json`) answers without one. The free no-key allowance the 2026-09-08 plan assumed is gone.
  A `CENSUS_API_KEY` is a build prerequisite (free, by email, at `api.census.gov/data/key_signup.html`)
  and deploys as a sensitive Terraform variable → Lambda env var (ADR-006), like `BLS_API_KEY`.
  The repo's `.env` carries the variable name with no value.
- **Terms.** Products must display *"This product uses the Census Bureau Data API but is not
  endorsed or certified by the Census Bureau."* (docs/licensing.md).
- **Vintages.** ACS 1-year and 5-year both run through **2024** (2024 5-year = 2020–2024); 2025 is
  not published yet. Decennial: `dec/pl` and `dec/dhc` 2020. **Population Estimates (`pep`) stopped
  at vintage 2021 in the API**; the only later PEP dataset is `pep/charv` 2023 (population by
  age/sex/race for state, county, metro — not places). SAIPE (`timeseries/poverty/saipe`) gives
  annual model-based poverty rate and median household income for state and county.
- **Geography.** ACS 1-year publishes **19** levels (us, region, division, state, county, county
  subdivision, place, metro, urban area, congressional district, PUMA, school district) but only
  for areas of **65,000+ population**; ACS 5-year publishes **65** levels for **all** areas,
  including tract and ZCTA. The `ucgid=` parameter accepts the catalog's UCGIDs directly
  (`1600000US0820000`), so no `for`/`in` assembly is needed for a resolved place.
- **Reliability is in the data, not around it.** Every estimate `…E` has a margin of error `…M`
  (90% confidence) and annotation columns `…EA` / `…MA`. Special values are sentinels, not
  numbers: `-666666666` (estimate could not be computed / median in an open-ended interval),
  `-999999999` (`N`, insufficient sample cases), `-888888888` (`(X)`, not applicable),
  `-222222222` (`**`, MOE could not be computed), `-333333333` (`***`), `-555555555` (`*****`,
  estimate controlled to an independent population estimate — MOE not appropriate), and `null`
  (no data for the geography). Medians hit open-ended bounds ("2,500-", "250,000+").
- **Where the headline indicators live** (all verified in 2024 metadata):

  | Indicator | ACS variable(s) | Table family |
  |---|---|---|
  | total population | `B01003_001E` | detailed |
  | median age | `B01002_001E` | detailed |
  | median household income | `B19013_001E` (2024 inflation-adjusted dollars) | detailed |
  | per capita income | `B19301_001E` | detailed |
  | poverty rate (%) | `S1701_C03_001E` | subject |
  | unemployment rate (%, ACS) | `S2301_C04_001E` | subject |
  | bachelor's degree or higher (% of 25+) | `S1501_C02_015E` | subject |
  | uninsured (% of civilian noninstitutionalized) | `S2701_C05_001E` | subject |
  | mean travel time to work (minutes) | `S0801_C01_046E` | subject |
  | median gross rent | `B25064_001E` | detailed |
  | median home value | `B25077_001E` | detailed |
  | owner-occupied share (%) | `DP04_0046PE` | profile |
  | median monthly housing cost | `S2503_C01_024E` | subject |

  Detailed (`acs/acs5`), subject (`acs/acs5/subject`) and profile (`acs/acs5/profile`) are three
  endpoints of the same product with different variable families; one indicator's variable comes
  from exactly one of them, and the `…M` companion is the same id with `M`.

## What M8 builds

- **`server-census`** on the core shell: `census_resolve_place` (mounted from core over the shared
  catalog), `census_get_indicator`, `census_list_indicators`, `census_compare_places`,
  `census_get_raw`, `census_describe_source`, plus one discovery tool, `census_search_tables`,
  over a vendored table index derived from the official server's seeds.
- **An ACS fetch capability** on the registry seam (`IndicatorDefinition.fetch`, ADR-011 §2): a
  definition names its variable and table family; the capability builds the query (`get=E,M,EA,MA`
  + `ucgid=`), picks the product (1-year or 5-year) by the place's population, parses sentinels,
  and returns observations shaped like the timeseries programs' (one observation per vintage, the
  value plus a margin of error).
- **Reliability as first-class envelope data:** margin of error on every value; a reliability
  grade from the coefficient of variation; annotation sentinels as `null` + caveat; the product
  chosen and why; the vintage.
- The Census API's required sentence in `census_describe_source`, the README and the connector
  docs.

## The decisions (numbered; recommendations given)

### 1. Indicator vocabulary for Release 2
Options: (a) the thirteen headline indicators above; (b) fewer (population, income, poverty, rent,
home value); (c) expose whole tables through the raw grammar only.
**Recommendation: (a)** — each is one variable, verified, and together they cover what city and
state policy staff ask first. Sub-dimension pickers (by race, age, tenure) are an M9 shape on the
same dimension seam; not in M8.

### 2. Product choice: 1-year vs 5-year, by population, flagged
ACS 1-year exists only for areas of 65,000+. **Recommendation:** the capability requests the
**1-year** product when the place's population (from the catalog's latest decennial/ACS total)
is ≥ 65,000 and the caller did not ask otherwise, else the **5-year** product, and every answer
names the product, its period ("2024" vs "2020–2024") and the reason. A `product` argument
(`1-year` | `5-year`) overrides; asking for 1-year below the threshold is answered with the 5-year
figure and a caveat, never an empty result. Tracts and ZCTAs are 5-year only.

### 3. Margins of error and reliability grades travel with every value
**Recommendation: yes, in the envelope's `data` and as a caveat when reliability is low.**
Each observation carries `value`, `marginOfError` (90%), and `reliability` computed from the
coefficient of variation (CV = MOE / 1.645 / estimate): `high` < 12%, `medium` 12–40%, `low`
> 40% (the convention ESRI and Census training materials use). A `low` grade adds a limitation
("this estimate has a coefficient of variation of 63%; treat it as indicative"). Percent
indicators carry the MOE in percentage points.

### 4. Annotation sentinels are null plus a caveat, never a number
**Recommendation:** every sentinel value maps to `value: null` with the Census meaning as the
caveat, and the `…EA`/`…MA` columns are always requested so the meaning is exact. An open-ended
median ("250,000+") becomes the bound with a caveat that the true value is at or above it.
`-555555555` (controlled estimate) returns the value with `marginOfError: null` and the note
that it is controlled to an independent estimate.

### 5. `compare_places` aligns on product and vintage
**Recommendation:** compare only within one product: if the places mix ≥65k and <65k, the
comparison uses the **5-year** product for all of them (the only one every place has) and says
so; the rows carry each place's MOE so the model can say whether a difference is meaningful. A
`significant` flag per pair is out of scope for M8 (needs the Census statistical-testing
formula; note it for M9).

### 6. Geography and the catalog
**Recommendation:** reuse the core catalog; `census_resolve_place` is core's resolver. The
catalog gains **population** on each entity (from `B01003_001E` 5-year at build, one query per
summary level via `for=…:*`) so decision 2 needs no runtime call. County subdivisions (New England
towns) are added to the catalog from the gazetteer when a story needs them — not in M8.1.

### 7. Discovery: `census_search_tables` over a vendored index
**Recommendation:** vendor a compact table index (table id, label, endpoint, years) derived by a
script from the official server's seed configs and `data.json`, ~32k rows, gzipped like the
Geocorr file, searched with FTS in the catalog build or a small SQLite of its own. It returns
table ids the caller feeds to `census_get_raw`. No runtime Postgres, no network at query time.

### 8. `census_get_raw` carries the Census API grammar
**Recommendation:** the input schema is the official server's `fetch-aggregate-data` grammar
(`dataset`, `year`, `get.variables` | `get.group`, `for` | `in` | `ucgid`, `predicates`,
`descriptive`), validated with the same rules, going through the core client with the key. The
response is the API's rows, wrapped in the envelope with the query as the source id.

### 9. Quota, cache, fixtures
**Recommendation:** all calls through the core client; long-TTL cache keyed by (dataset, vintage,
variables, ucgid) — ACS vintages are immutable once released; recorded fixtures for every
indicator at Denver County and one below-65k place; live smoke under `LIVE_TESTS=1` only. No
mirror (#51 stays deferred).

### 10. Other Census datasets
Decennial 2020 (`dec/pl` P1_001N) as a `decennial_population` indicator with no MOE; SAIPE as the
county poverty/income *annual* alternative; PEP dropped (API stops at 2021, `pep/charv` covers no
places). **Recommendation:** decennial population in M8; SAIPE and `pep/charv` deferred to M9 with
a note in `describe_source`.

### 11. Scope and version
M8 = one new package `server-census`, its Terraform instance (`census-mcp.responsive.city`), the
ACS capability, thirteen ACS indicators + decennial population, reliability rules, table search,
raw grammar, evals, docs; ships as **v0.3.0**. Out: sub-dimension pickers, county subdivisions,
significance testing, SAIPE/PEP, the composite endpoint.

## Proposed build-issue cut (from the rulings, not before)

1. **M8.1 Package + shell + key** — `packages/server-census` scaffolded on the core (definition,
   `census_resolve_place` from core, `describe_source` with the required sentence), Terraform
   module/instance, `CENSUS_API_KEY` plumbing, contract suite green with zero indicators.
2. **M8.2 ACS fetch capability + reliability seam** — query builder over `ucgid`, product choice
   by population (needs 6), sentinel/MOE/CV parsing into observations; recorded fixtures.
3. **M8.3 Catalog population column** — geography-build pulls 5-year total population per summary
   level; `PlaceCandidate.population`.
4. **M8.4 Indicators** — the thirteen ACS definitions + decennial population on the seam; tests
   per indicator against fixtures; `list_indicators`.
5. **M8.5 `census_compare_places` + `census_get_raw`** — product alignment rule; the grammar.
6. **M8.6 Table index + `census_search_tables`** — derivation script, vendored gz, FTS.
7. **M8.7 Reconcile + evals + release** — docs, connect quickstart, eval cases (a ≥65k city on
   1-year, a small city falling to 5-year flagged, a low-reliability tract, a sentinel median, a
   mixed compare), deploy, v0.3.0.

Order: 8.1 → 8.2 + 8.3 in parallel → 8.4 → 8.5 + 8.6 in parallel → 8.7.

## Prerequisite (owner)

A Census Data API key in `.env` as `CENSUS_API_KEY` before M8.2's fixtures can be recorded.

# Spike: M14 — BEA Regional economic accounts by place (server-bea)

Epic #253, spike #252. Should BEA's Regional data (county, state and metro personal income, GDP
and regional price parities) become `server-bea` on the federal-mcps core, and how? Everything
marked *verified* was checked live on 2026-09-28 with the owner's key (`BEA_API_KEY` in the
gitignored `.env`; never printed or committed), or read from BEA's own *API for Data Retrieval
User Guide* (April 20, 2026, Appendix N — Regional, April 24, 2026) and API Terms of Service.
The spike ends in decision questions; no build issue is cut before the owner rules.

## What the BEA API is, verified

**Base and access.** `https://apps.bea.gov/api/data?UserID=<key>&method=…&datasetname=…`, `GET`,
JSON or XML. The key is a 36-character UUID in the **query string**. A new key answers
"This UserId is not active" until activated from BEA's email, and activation took several minutes
to reach the API (*verified*).

**The key comes back in every response body.** `BEAAPI.Request.RequestParam` echoes
`USERID` verbatim (*verified*: one occurrence per response). Unlike HUD's bearer header, a
recorded fixture or a cached body would carry the key to disk. The core client's `queryAuth`
already keeps it out of URLs, cache keys and logs; the **body** needs redacting before any cache
or fixture write.

**Limits** (guide p. 5–6, *verified* text): per user, 100 requests a minute, 100 MB a minute, and
**30 errors a minute**. Exceeding any gives HTTP 429 with `Retry-After` (about 60 s) for every call
in the timeout. The terms add that BEA may block a user who "attempted to exceed or circumvent"
limits. **Errors come back as HTTP 200** with `BEAAPI.Results.Error.APIErrorCode` in the body
(*verified*: code 40 for a bad TableName, 4 for an inactive key, 101 "Unknown error"). The core
client sees a 200, so a BEA fetch must read the body for an error, and it must not retry a
parameter error: each counts against the 30-a-minute error budget.

**Terms of Service** (`apps.bea.gov/API/_pdf/bea_api_tos.pdf`, read 2026-09-28): services "should
display the following notice prominently": **"This product uses the Bureau of Economic Analysis
(BEA) Data API but is not endorsed or certified by BEA."** The BEA name may identify the source,
never imply endorsement. Content may not be modified or misrepresented while claiming BEA as the
source. This is the same shape as HUD User's; core's `citationSuffix` (#237) already carries it.

### The Regional dataset

Parameters (Appendix N): `TableName` (one), `LineCode` (one, or `ALL` with a single GeoFips),
`GeoFips` (a **comma list**, or `STATE`, `COUNTY`, `MSA`, `PORT`, `TERR`, or a state's USPS code
for all its counties), `Year` (a comma list, `LAST5` default, `LAST10`, `ALL`). 105 tables
(*verified*).

| What a policy question asks | Table · line | Levels (*verified*) | Years | Unit |
|---|---|---|---|---|
| Personal income | `CAINC1`·1, `SAINC1`·1, `SQINC1`·1 | county, state; state quarterly | 1969→2024 county; 1948→2026Q1 quarterly | thousands of dollars (`UNIT_MULT` 3) |
| Per capita personal income | `CAINC1`·3, `SAINC1`·3, `SQINC1`·3 | county, state, state quarterly | as above | dollars (`UNIT_MULT` 0) |
| GDP, current dollars, by industry | `CAGDP2`·1 (all), ·11 construction, … | county, state (`SAGDP2`) | 2001→2024 | thousands of dollars |
| Real GDP, by industry | `CAGDP9`·1, … | county, state (`SAGDP9`) | 2001→2024 | thousands of chained 2017 dollars |
| Regional price parities | `MARPP`·1–5 (all items, goods, rents, utilities, other services), `SARPP` | **metro** (387 MSAs), state | 2008→2024 | index, U.S. = 100 |

GDP line codes carry their NAICS sector in the description (`[CAGDP9] Real GDP: Construction
(23)`), so an `industry` picker can be built from BEA's own line list, not typed.

Worked values (*verified*): St. Joseph County, IN per capita personal income 2021–2024 = 55,841 ·
56,225 · 56,869 · 59,030; real GDP 2023 = 15,118,595 (thousands of chained 2017 $); Indiana per
capita personal income 2026Q1 = 67,272; RPP all items 2024 — Denver metro 105.782, South Bend
metro 92.858; Denver rents RPP 146.919.

### Caveats arrive in the response — and some as zeros

- **Suppression is a zero.** A disclosure-suppressed cell comes back as `DataValue: "0"` with
  `NoteRef: "(D)"` — "Not shown to avoid disclosure of confidential information; estimates are
  included in higher-level totals" (*verified*: Loving County, TX construction GDP 2023). Likewise
  **`(NA)` "not available" is a zero** (*verified*: Connecticut, below). A parser that reads
  `DataValue` alone reports $0. Every marker must become a null value plus the note's text.
- **Revisions are stated in band.** Every response carries a note such as "Last updated: February
  5, 2026 — new statistics for 2024; revised statistics for 2020–2023" (*verified*). It belongs in
  every answer's limitations: the vintage, and which years just moved.
- **Units are per row.** `CL_UNIT` and `UNIT_MULT` travel on each data row; a table-wide note
  ("All dollar estimates are in thousands of current dollars") is wrong for per capita rows (dollars,
  `UNIT_MULT` 0). The row wins.
- **Geography history is a shared `*` note.** One `NoteRef` `*` holds a dozen unrelated notes
  (Alaska census-area splits, Broomfield CO from 2002, Kalawao combined with Maui, Virginia
  combination areas, Connecticut planning regions from 2024). A row flagged `*` cannot say which one
  applies; the server has to match by place (a small table keyed by GeoFips), not by key.

### Push-down works: one call answers many places

`GeoFips=COUNTY&Year=2024` for one line returned **all 3,149 county-level areas in one call — 486 KB
in 2.1 s** (*verified*). A comma list of specific places works too (*verified*: three counties; two
metros for MARPP). So `compare_places` is one request, and "every county in a state" is one request
with the state's USPS code. This is the filter-and-aggregate push-down the owner raised for #51,
native to BEA: no mirror is needed for these questions.

## Geography against the family catalog

- **Counties are Census FIPS** — with exceptions (*verified* by diffing BEA's `CAINC1` GeoFips list
  against the 2025 catalog):
  - **23 Virginia combination areas** (`51901` Albemarle + Charlottesville … `519xx`) and **Maui +
    Kalawao** (`15901`) replace their component counties and independent cities.
  - Historical Alaska census areas and 1970 divisions (`02901`…) for early years.
  - 131 catalog counties have no BEA row of their own: the Virginia and Hawaii components, and
    Puerto Rico's 78 municipios (BEA covers Puerto Rico separately, `PRGDP*`, territory-level).
- **Connecticut is two series that do not overlap** (*verified*): the eight old counties carry data
  through 2023 and `(NA)` for 2024; the nine planning regions carry 2024 and `(NA)` before
  (both list 1969→2024 as "available" years). BEA's note: "Estimates for 2024 forward reflect
  Connecticut county-level statistics using the state's nine planning regions." A history for a
  planning region stops at 2024; stitching the old county onto it would be a different place.
- **Metros are CBSA codes on the 2023 OMB delineation** — all 387 `MARPP` metros are catalog CBSAs
  (*verified*). **But metro personal income and GDP did not answer**: BEA's filter lists `CAINC1` and
  `CAGDP9` for GeoFips `43780`, yet `GetData` for a metro code in those tables returned error 101
  "Unknown error" (*verified*, twice). BEA publishes metro income and GDP on its site; whether the API
  takes a different code form is unverified.
- **States** are `SS000`, the nation `00000`, and **BEA regions** `91000`–`98000` (New England,
  Mideast, Great Lakes, Plains, Southeast, Southwest, Rocky Mountain, Far West) — BEA's own eight,
  not the Census regions the catalog carries.
- **Cities and towns**: BEA publishes none. A city answers with its county (the Census and HUD
  pattern), flagged.

## Against ADR-015's server test

A plain agency API with a key, per-minute limits, a query grammar with codes the catalog must
build, and caveats that arrive as zero-valued sentinels — every criterion for a server on the core,
none for a portal source guide. **Result: a server** (`server-bea`), as expected.

## What M14 would build

`packages/server-bea` on the core, the family verbs (`bea_resolve_place`, `bea_get_indicator`,
`bea_compare_places`, `bea_list_indicators`, `bea_get_raw`, `bea_describe_source`), its own Terraform
module and hostname, like Census and HUD. New seams, all small:

- a response sanitizer in the core HTTP client (redact the echoed key before cache/fixture writes);
- body-level error detection for a source that answers errors with HTTP 200, with no retry on a
  parameter error;
- `bea`/`GEOFIPS` agency codes in the catalog for the exceptions (Virginia and Maui combinations);
- compare_places issuing one GetData per indicator with a GeoFips list.

## Decisions for the owner

1. **First-release scope.** *Recommended:* five indicators — `personal_income`,
   `per_capita_personal_income` (county, state; `frequency` annual|quarterly for states), `gdp` and
   `real_gdp` (county, state; an `industry` picker from BEA's NAICS line list), and
   `regional_price_parity` (metro, state; an `item` picker: all items, goods, rents, utilities, other
   services). Defer PCE by state, earnings and compensation detail (`CAINC4`–`CAINC6N`), the arts
   satellite account and Puerto Rico's territory tables.
2. **Hostname.** *Recommended:* `bea.responsive.city`, the short-name pattern of ADR-016.
3. **Key and body redaction.** *Recommended:* the key as `queryAuth` (as Census), plus a core
   `sanitize` hook on `createHttpClient` that strips `USERID` from a body before it is cached or
   recorded — generic, so any agency that echoes a credential is covered. A test asserts no fixture
   contains the key.
4. **Limits and errors.** *Recommended:* the #231 per-minute limiter at 90 a minute (under BEA's 100),
   honour `Retry-After` on 429, read `APIErrorCode` from 200 bodies as errors, and never retry codes
   that mean a bad parameter (4, 40, 101): they cost the 30-a-minute error budget. Revisit with the
   owner's earlier "we might need to revise the rate limiting later" if a real limit is hit.
5. **Sentinels.** *Recommended:* any row with a `NoteRef` marker in parentheses (`(D)`, `(NA)`, and
   any other BEA publishes) becomes a null value with the note's own text as a footnote — never the
   `0` in `DataValue`. A unit test per marker against recorded responses.
6. **Virginia and Maui combinations.** *Recommended:* catalog `bea`/`GEOFIPS` codes on each component
   (Albemarle County and Charlottesville city → `51901`), so a component answers with the combination
   and a caveat naming it ("BEA publishes Albemarle County combined with Charlottesville city"), the
   way LAUS's below-threshold fallback works. Not typed: built from BEA's own GeoFips list names, which
   list the components.
7. **Connecticut.** *Recommended:* serve the planning regions (the catalog's current counties) from
   2024; a request for earlier years says the series begins in 2024 and why, and does not stitch the
   old counties onto it.
8. **Metro income and GDP.** Two options: (a) wait and verify the API's metro form with BEA
   (developers@bea.gov) before promising metro GDP; (b) sum a metro from its counties with the
   catalog's county→CBSA membership — exact for personal income and current-dollar GDP (they add),
   **not** for real GDP (chained dollars do not add) or anything suppressed. *Recommended:* ship metro
   RPPs (verified) in the first release, file (a) as a question to BEA, and decline to sum real GDP.
9. **Push-down and raw.** *Recommended:* `bea_get_raw` carries BEA's grammar — TableName, LineCode,
   GeoFips list or special value (`COUNTY`, `STATE`, a USPS code), Year list or `LAST5`/`LAST10` — with
   the ADR-017 compact renderer and budget. With `Year=ALL` and `GeoFips=COUNTY` both allowed, the raw
   tool caps one of them (BEA's own advice: "do not overuse ALL").
10. **Caching.** *Recommended:* 7 days, with the in-band "Last updated … revised statistics for …"
    note on every answer so a cached value states its vintage. BEA publishes on a known schedule;
    a release-aware TTL is a later refinement.
11. **BEA regions.** *Recommended:* defer. States and the nation cover the questions; the eight BEA
    regions would be a second region system beside the Census one the catalog already carries.
12. **Versioning.** *Recommended:* v0.7.0.

## Proposed build cut (after the rulings)

1. Core: the response `sanitize` hook and 200-body error handling in the HTTP client (tests with a
   fake BEA body).
2. Catalog: `bea`/`GEOFIPS` combination codes (Virginia, Maui) from BEA's GeoFips list.
3. `server-bea` shell: package, key, Terraform, hostname, `describe_source` with the required sentence.
4. Indicators: personal income and per capita (county, state, state quarterly).
5. Indicators: GDP and real GDP with the `industry` picker.
6. Indicators: regional price parities (metro, state) with the `item` picker.
7. `bea_compare_places` batched by GeoFips list; `bea_get_raw`; evals; docs; v0.7.0; owner deploys.

## Not verified

- The API's form for metro personal income and GDP (error 101 on CBSA codes in `CAINC1`/`CAGDP9`).
- Markers beyond `(D)` and `(NA)` (BEA's tables also use `(NM)` not meaningful and `(L)` less than
  $50,000 in some releases); seen in no response here.
- Whether 429 responses carry the same `USERID` echo (not triggered deliberately).
- BEA's exact release calendar for Regional tables in 2026–27.

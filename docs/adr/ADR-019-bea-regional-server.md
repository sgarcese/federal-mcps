# ADR-019: The BEA Regional server

**Status:** accepted (2026-09-28) · **Spike:** [`m14-bea-regional`](../spikes/m14-bea-regional.md) ·
**Epic:** #253 · **Rulings:** recorded on #252 ·
**Affects:** new `packages/server-bea`, `packages/core` (HTTP client: a response sanitizer and
200-body errors), `packages/geography-build` (BEA combination codes), `terraform/` (a module and the
instance), `scripts/` (deploy, admin role), `docs/`

## Context

BEA's Regional economic accounts carry the place-level economy a policy analysis turns on — personal
income and per capita income, GDP and real GDP by industry, regional price parities — by county,
state and metro. They complement what BLS (labor, prices) and Census (income, housing) already answer.
The API is a plain agency API with a registered key, per-minute limits, a query grammar keyed by codes
the catalog must build, and caveats that arrive in band. The spike found four things a naive client
would get wrong: suppressed and unavailable cells arrive as `DataValue "0"` with a `(D)` / `(NA)` marker;
the key is echoed in every response body; errors come back as HTTP 200 and count against a 30-errors-a-
minute budget; and metro income and GDP answered error 101 in the county tables.

## Decision (owner rulings, 2026-09-28)

1. **A dedicated server, `server-bea`**, on the family core, tools prefixed `bea_` (`bea_resolve_place`
   from core, `bea_get_indicator`, `bea_compare_places`, `bea_list_indicators`, `bea_get_raw`,
   `bea_describe_source`). ADR-015's test gives a server: an API, not a portal.
2. **Scope:** `personal_income` and `per_capita_personal_income` (county `CAINC1`, state `SAINC1`; a
   `frequency` picker, annual or quarterly `SQINC1`, for states), `gdp` and `real_gdp` (county
   `CAGDP2`/`CAGDP9`, state `SAGDP2`/`SAGDP9`; an `industry` picker built from BEA's own NAICS line
   list), `regional_price_parity` (metro `MARPP`, state `SARPP`; an `item` picker — all items, goods,
   rents, utilities, other services). Deferred: PCE by state, earnings and compensation detail, the
   arts satellite account, Puerto Rico's territory tables, BEA's eight regions.
3. **The key** (`BEA_API_KEY`, a sensitive Terraform variable on the Lambda, ADR-006) rides as
   `queryAuth`, never in a URL, cache key or log. **A generic core `sanitize` hook** on
   `createHttpClient` strips an echoed credential (BEA's `RequestParam` `USERID`) from a body before it
   is cached or recorded; a test asserts no fixture holds the key.
4. **Limits and errors:** the core per-minute limiter (ADR-018 §5) at 90 a minute, under BEA's 100;
   `Retry-After` honoured on 429; an `APIErrorCode` in a 200 body is an error; parameter errors (codes
   4, 40, 101) are never retried — each spends the error budget, and BEA's terms allow blocking a user
   who tries to exceed limits.
5. **Sentinels are never numbers:** a row whose `NoteRef` carries a parenthesized marker (`(D)`,
   `(NA)`, and any other BEA publishes) is a null value with the marker's note text as a footnote.
6. **Geography from the catalog, never typed:** counties are Census FIPS; metros are CBSA codes (2023
   OMB delineation); states `SS000`. **Virginia combination areas and Maui + Kalawao** become `bea` /
   `GEOFIPS` agency codes on each component county or independent city, built at catalog time from
   BEA's GeoFips list; a component answers with its combination and a caveat naming it. Cities answer
   with their county, flagged. **Connecticut** answers with its planning regions from 2024; earlier
   years are reported as not published for that geography, never stitched from the old counties.
7. **Metro income and GDP** are not promised: metro regional price parities ship; the error-101 form
   is a question to BEA; real GDP is never summed from counties (chained dollars do not add).
8. **Every answer states its vintage:** BEA's in-band "Last updated … new statistics for …; revised
   statistics for …" note travels in the limitations; responses cache for 7 days.
9. **`bea_get_raw`** carries BEA's grammar — `TableName`, `LineCode`, a `GeoFips` list or special
   value (`COUNTY`, `STATE`, a USPS code), a `Year` list or `LAST5`/`LAST10` — with the ADR-017 compact
   renderer and budget; at most one parameter may be `ALL`. With one call returning every county
   (verified: 3,149 areas, 486 KB), `bea_compare_places` batches places into one `GeoFips` list.
10. **Attribution:** "This product uses the Bureau of Economic Analysis (BEA) Data API but is not
    endorsed or certified by BEA." in `bea_describe_source`, the instructions and every citation (core
    `citationSuffix`, #237).
11. **Deployment:** `bea.responsive.city/mcp`, its own module and instance wiring like Census and HUD,
    deployed by the owner (ADR-007).
12. **Release:** v0.7.0.

## Consequences

- The core HTTP client gains two generic capabilities — a body sanitizer and body-level error
  detection — that any future agency with the same habits reuses.
- The catalog gains BEA's combination codes; nothing else in it changes.
- Compare and "every county in a state" are one upstream call each: the filter-and-aggregate
  push-down the owner raised for #51 is native to BEA, so this server needs no mirror.
- Metro GDP and personal income remain a known gap until BEA answers or a verified API form exists.

## Alternatives rejected

- **Sum metro GDP from counties now:** exact only for additive measures, silently wrong for real GDP,
  and wrong wherever a component is suppressed.
- **Stitch Connecticut's old counties onto the planning regions:** a different geography presented as
  one series.
- **Treat `0` as zero:** reports suppressed and unavailable cells as real values.
- **A source guide over a portal connector:** BEA has no portal; its grammar and limits are what a
  server on the core is for (ADR-015).

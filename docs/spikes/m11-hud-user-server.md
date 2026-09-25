# Spike: M11 — the HUD User server (FMR, Income Limits, CHAS, Picture of Subsidized Households)

Epic #217 ruled the hybrid: HUD's ArcGIS Hub layers stay "source guide + OpenContext connector"
(ADR-015), and the **HUD User API** gets a dedicated server on the federal-mcps core. This spike
verifies that API end to end with a registered token and ends in decision questions. Everything
marked *verified* was checked live on 2026-09-24 with the owner's token (`HUD_USER_TOKEN` in the
gitignored `.env`; never printed or committed).

## What the HUD User API is, verified

**Base and access.** `https://www.huduser.gov/hudapi/public/…`, `GET` only, JSON, bearer token in
`Authorization`. Without a token every data call returns **401**. Responses carry
`x-ratelimit-limit: 60` and `x-ratelimit-remaining`.

**Terms of Service** (`/portal/dataset/api-terms-of-service.html`, read 2026-09-24):
- "The limit on the maximum number of API calls is **60 queries a min**." Exceeding or circumventing
  it may get the token blocked.
- Every service using the API "should display the following notice prominently":
  **"This product uses the HUD User Data API but is not endorsed or certified by HUD User."**
- Content may not be modified or falsely represented while claiming HUD User as the source.
- Provided "as is"; HUD User may change the terms or cut access.

### Datasets (endpoint · identifiers · depth · shape)

| Dataset | Endpoint | Entity id | History | Notes |
|---|---|---|---|---|
| **Fair Market Rents** | `fmr/data/{entity}?year=` | county `SSCCC99999` (St. Joseph IN = `1814199999`); metro `METRO43780M43780`; New England towns `SSCCCTTTTT` (Boston = `2502507000`) | **FY2017–FY2027** (FY2016 → 400) | Current = **FY2027** (effective 2026-10-01); the Hub layer still carries FY2026. A county answer names its FMR area (St. Joseph → "South Bend-Mishawaka, IN HUD Metro FMR Area"), so the API does the county → area mapping. 0–4 bedroom rents. |
| **Small Area FMRs** | same call | county/metro in a SAFMR area | same | `smallarea_status: "1"` and `basicdata` becomes a list of ZIP rows (Cook County IL: 371 rows, first is "MSA level"); elsewhere `null` and one row. |
| **Lists** | `fmr/listStates`, `fmr/listCounties/{ST}`, `fmr/listMetroAreas` | — | — | County entity ids per state; metro codes with names. |
| **Income Limits** | `il/data/{entity}?year=`, `il/statedata/{ST}` | as FMR | **FY2017–FY2026** (2016 → 400) | Median family income plus extremely-low (30%), very-low (50%) and low (80%) limits for household sizes 1–8. St. Joseph 2026: median $88,100; 80% for 4 people $70,500. HUD warns that some states' county FIPS changed for IL 2025 (Connecticut's planning regions); a probe of two CT codes returned 404, so this is **not yet verified**. |
| **MTSP limits** | `mtspil/data/{entity}` | as FMR | — | 20%–80% bands, HERA special 50/60%, `median_income`. For tax-credit rents. |
| **CHAS** | `chas?type=&stateId=&entityId=&year=` | type 2 state, 3 county (`stateId=18&entityId=141`), 5 place (`entityId=71000`) | **2012–2016 … 2018–2022** releases | Newest is **2018–2022**; the Hub carries 2016–2020. Returns about **132 summary fields** (`A1`…), not the 408 raw columns; the field meanings come from HUD's CHAS API data dictionary. |
| **Picture of Subsidized Households** | `picture?type=&year=&census=&statecode=&entityid=` | its own summary-level codes (1 nation, 3 state, 4 PHA, 5 CBSA, 6 project, 7 tract, 8 city, **9 county**, 10 ZIP, 11 congressional district). Entity ids are standard FIPS: county `18141`, city `1871000` (from `picture/lookup/*`) | **2012–2025** (docs say 2024; 2025 answers; 2011 → 400) | `census` is required: 2010 for 2012–2021, 2020 for 2023 on, either for 2022. One row per program (St. Joseph 2024: summary 5,965 units; public housing 886; vouchers 3,075; project-based Section 8 1,772; 202/PRAC 190; 811/PRAC 42) with about 70 tenant and unit fields. `-1` marks not reported. **The 2012 values are strings** ("6068"), later years numbers. |
| **USPS ZIP crosswalk** | `usps?type=&query=` | ZIP or county FIPS | quarterly; current **2026 Q2** | ZIP → county with residential/business/other/total ratios (46601 → 18141, 1.0); county → ZIPs (St. Joseph: 31). |

### Identifiers against the family catalog

- **County:** our `geoid` (`18141`) → FMR/IL `1814199999`, CHAS `stateId=18&entityId=141`, Picture
  `statecode=IN&entityid=18141`. All derivable; no hand-typed tables.
- **Place:** our 7-digit `geoid` (`1871000`) is Picture's city id and, split, CHAS's `entityId=71000`.
- **Metro:** FMR/IL use HUD FMR area codes (`METRO43780M43780`), which can differ from the CBSA when
  HUD splits a metro into HUD Metro FMR Areas. The county answer names its area, so the server can
  resolve county → area through the API instead of a catalog table.
- **New England:** FMR and IL are town-based; entity ids are county subdivisions (`2502507000`).
- **Tract / ZIP:** Picture (7, 10) and SAFMR (ZIP rows) go below the county.

## Against ADR-015's server test

All three conditions hold: an **id grammar** (four different entity schemes above, and
Picture's summary-level codes and census-vintage rule), a **quota** (60 queries a minute per token,
one token shared by every user of a hosted server), and a **contract** host users need
(citations, the required HUD User sentence, suppression and vintage as data).

## What M11 builds

`packages/server-hud` on the core, tools prefixed `hud_`: `hud_resolve_place` (core),
`hud_get_indicator`, `hud_compare_places`, `hud_list_indicators`, `hud_get_raw`,
`hud_describe_source`. The token rides as a sensitive Terraform variable (ADR-006), the HUD User
sentence appears in `describe_source` and every citation, and results are cached long (FY data is
fixed once published).

## Decisions for the owner

1. **First-release scope.** FMR (with history and Small Area FMRs by ZIP), Income Limits (with
   MTSP), CHAS (a curated set of cost-burden measures), and Picture of Subsidized Households (program
   totals and a curated set of tenant fields). *Recommended: all four.* The USPS crosswalk is
   geography, not a statistic: see 5.
2. **Hostname.** `hud.responsive.city` is the Hub portal. *Recommended:* `huduser.responsive.city`,
   service `rc-huduser-mcp`. The Hub portal keeps its name.
3. **Rate limiting.** *Recommended:* a per-minute token bucket in the core HTTP client, configured
   per source (HUD User 60/minute), next to the existing daily budget. Every server gets it; the quota
   rule says all upstream calls go through the core client.
4. **FMR areas.** *Recommended:* no catalog column. The API maps a county to its FMR area itself;
   the server calls it per county and caches the answer. Metro questions use the area code the API
   returns.
5. **USPS crosswalk.** *Recommended:* into the geography catalog build later (ZIP → county shares),
   not a HUD tool. Out of M11.
6. **Indicators and dimensions.** *Recommended:* `fair_market_rent` (`bedrooms` 0–4, default 2;
   `zip` rows when the area is a Small Area FMR area), `income_limit` (`level` 30/50/80, `household_size`
   1–8, defaults 80% and 4), `area_median_income`, `mtsp_limit`, CHAS `cost_burden_renters` and
   `cost_burden_owners` (over 30% and over 50%), and Picture `subsidized_units`, `subsidized_people`,
   `average_household_income`, `share_below_30_ami`, `months_waiting` (`program` dimension, default all).
   Years are fiscal years for FMR and IL, stated as such.
7. **New England.** *Recommended:* support towns through the catalog's county subdivisions, the way
   LAUS already does; a county question in New England answers per town with a caveat.
8. **Versioning.** *Recommended:* v0.6.0.

## Proposed build cut (after the rulings)

1. Package, shell, token, Terraform module and instance, `huduser.responsive.city`, admin role.
2. Core: per-minute limiter.
3. Entity ids from the catalog (county, place, New England town, metro via the API) and the fetch
   capability with fixtures.
4. FMR and Small Area FMR indicators.
5. Income Limits and MTSP.
6. CHAS (with the data-dictionary mapping for the curated measures).
7. Picture of Subsidized Households (census-vintage rule, string/number normalisation, `-1`).
8. Compare, `hud_get_raw` (the four endpoints only), evals, reconcile, deploy, v0.6.0.

About eight issues, the size of M8.

## Not verified

- The Connecticut Income Limits codes after the 2025 FIPS change (two probes returned 404).
- The CHAS summary-field dictionary (`A1`…): taken from HUD's CHAS API page at build time.
- Picture's full suppression code set beyond `-1`.
- Whether HUD User throttles by token or by IP when a hosted server serves many users.

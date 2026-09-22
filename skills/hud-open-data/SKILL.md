---
name: hud-open-data
description: Answer housing questions for a U.S. county, city, tract or ZIP from HUD's ArcGIS Hub open data (Fair Market Rents and Small Area FMRs, Housing Choice Vouchers by tract, low-and-moderate-income shares, Qualified Census Tracts, Difficult Development Areas, LIHTC properties, public housing, assisted multifamily, Continuum of Care areas) with the right dataset, layer, join key and vintage. Use with geo_resolve_place and an OpenContext ArcGIS connector for data.hud.gov.
---

# HUD Open Data (ArcGIS Hub) source guide

HUD publishes its geospatial open data on ArcGIS Hub (`data.hud.gov`,
`hudgis-hud.opendata.arcgis.com`; 103 feature services). Verified live on 2026-09-20. Federal
public data; every item carries HUD's no-warranty statement — cite "U.S. Department of Housing
and Urban Development, <dataset name>, HUD Open Data (ArcGIS Hub), accessed <date>".

## Tools you need

- `geo_resolve_place` (federal-mcps geo server): candidates with `geoid`, parents (county,
  CBSA/metro) — HUD keys are built from these.
- An OpenContext ArcGIS connector on `https://data.hud.gov` (`arcgis__search_datasets`,
  `arcgis__get_dataset`, `arcgis__query_data {dataset_id, where, out_fields, limit}`).
  The family's deployment at **`https://hud.responsive.city/mcp`** runs the fixed connector
  (2026-09-22): `arcgis__get_schema` works and services whose only layer is not id 0 resolve.
  Field names below still save a call.

## Datasets (Hub item id · what the key is)

| Dataset | Item id | Key | Key fields | Vintage |
|---|---|---|---|---|
| Fair Market Rents | `12d2516901f947b5bb4da4e780e35f07` | `FMR_CODE` (see below); no FIPS column | `FMR_AREANAME`, `FMR_0BDR`…`FMR_4BDR` | FY2026 (effective 2025-10-01) |
| Small Area FMRs (ZIP) | `6458c67bad2a4cc7aa97514ef7ba8a0e` | values are in **table layer 1** keyed `ID` = ZIP, `HUD_CODE`; layer 0 is ZCTA geometry only, and the connector resolves the first *layer*, so SAFMR values are still not reachable — use FMR or the HUD SAFMR page | `SAFMR_2BR`, `*_90_Payment_Standard`, `*_110_Payment_Standard` | FY2026 |
| Housing Choice Vouchers by Tract | `8d45c34f7f64433586ef6a448d00ca12` | `GEOID` (11-digit tract) | `HCV_PUBLIC` voucher households; `HCV_PUBLIC_PCT` = % of renter-occupied units (2020 Census DHC H4) | current PIH extract |
| Low-Mod Income Population by Block Group | `09eceb08d95d429dae9f88fe39826bf1` | `GEOID` (12-digit) | `Lowmod`, `Lowmoduniv` (strings with commas), `Lowmod_pct` (0–1), `MOE_LOWMOD_PCT` (+/-x%), `Source` | "ACS 2020-2016" (2016–2020 ACS) |
| Low-Mod Income Population by Tract | `3bd6767dcc5e4937a6232d9db04dd447` | `GEOID` | `LOWMODPCT` (0–100) | its only layer is id 4; reachable since the 2026-09-22 connector fix (tract 08031000800 → 100) |
| Qualified Census Tracts 2026 | `f55f80843c9a436ba8e578a54cdd8cea` | `GEOID`, `STATE`, `COUNTY` (padded) | presence = QCT | 2026 designation |
| Difficult Development Areas 2026 | `87d645f216024a07936c0f8bb0f20366` | `ZCTA5` | `DDA_CODE`, `DDA_TYPE`, `DDA_NAME` | 2026 |
| LIHTC Properties | `810ccb34dd464ec4ad4697d35fff21a5` | `STATE2KX`, `CNTY2KX` **unpadded strings** (`'8'`, `'31'`), `PLACE2KX` 5-digit, `TRACT2KX` | `PROJECT`, `LI_UNITS`, `N_UNITS`, `YR_PIS`, `QCT`, `DDA`, `NONPROG` | current HUD LIHTC database |
| Public Housing Developments | `5c96143f79c940a0a8cedae99a1ac562` | `STATE2KX`, `CNTY2KX` **zero-padded** (`'08'`, `'031'`), `PLACE2KX` | `PROJECT_NAME`, `TOTAL_UNITS`, `PCT_OCCUPIED`, resident-mix `PCT_*` | current PIH extract |
| Multifamily Properties – Assisted | `f4721da932a94b218bdb5a861fd7429e` | `STATE2KX`, `CNTY2KX` zero-padded | `PROPERTY_NAME_TEXT`, `TOTAL_ASSISTED_UNIT_COUNT`, `TOTAL_UNIT_COUNT` | current |
| Opportunity Zones | `ef143299845841f8abb95969c01f88b5` | `GEOID10` (2010 tracts) | — | only layer is id 13; reachable since the 2026-09-22 connector fix |
| Continuum of Care Grantee Areas | `c930d736b1764c259371fc7111e02740` | `COCNUM` (`CO-503`), `COCNAME` | PIT counts `SH_PERS_HWAC`, `UNSH_PERS_HWAC`, `SH_VETS`, `UNSH_VETS`, `SH_CH`, `UNSH_CH` | **`YEAR` is null** in the layer — say the count year is not stated; HUD Exchange has dated PIT reports |

**Not on the Hub** (say so; do not substitute): Income Limits (huduser.gov API), PIT counts by
year (HUD Exchange), Picture of Subsidized Households.

## FMR area codes (built from the resolved place, never typed from memory)

- County inside a metro: `METRO<cbsa>M<cbsa>` — Denver County → CBSA 19740 → `METRO19740M19740`.
- HUD Metro FMR sub-areas split some metros: `METRO<cbsa>MM<code>` or `METRO<cbsa>N<countyfips>`
  (e.g. `METRO11100N48359` Oldham County, TX). If the simple code returns no row, query
  `FMR_AREANAME LIKE '%<county name>%'` and take the HUD Metro FMR Area row.
- Nonmetro county: `NCNTY<fips>N<fips>` (`NCNTY01005N01005` Barbour County, AL).
- Cities have no FMR of their own; use the county's area and say so. 2,622 areas in FY2026.

## Recipe

1. Resolve: `geo_resolve_place`. Take `geoid`; for FMR also the county's CBSA (parents).
2. Query by key: `arcgis__query_data {dataset_id, where: "GEOID='08031000800'", out_fields:
   "GEOID,HCV_PUBLIC,HCV_PUBLIC_PCT", limit: 5}`. Use the field names above.
3. Report the number, its vintage (FY / ACS years / "current extract, year not stated"), the
   geography and dataset, and the HUD citation.

## Never

- Never build a county key with the wrong padding: LIHTC uses `'8'`/`'31'`, public housing and
  multifamily use `'08'`/`'031'`. A zero count from the wrong padding is not "none".
- Never sum `LI_UNITS` as "affordable units in the city" without saying LIHTC only, and that
  `NONPROG` rows may have left the program.
- Never report a CoC PIT count as this year's without saying the layer carries no year.
- Never call FMR a market rent: it is the 40th-percentile gross rent HUD sets for vouchers.
- Never treat "Low-Mod" as poverty: it is ≤80% of area median income (CDBG definition).

## Worked examples (verified 2026-09-20)

- **Denver metro FMR FY2026:** `FMR_CODE='METRO19740M19740'` → 0BR $1,643 · 1BR $1,754 · 2BR $2,089.
- **Sedona, AZ (Yavapai County):** metro Prescott Valley-Prescott → `METRO39150M39150`, 2BR $1,637.
- **Tract 08031000800 vouchers:** `HCV_PUBLIC` 429, `HCV_PUBLIC_PCT` 100 (% of renter-occupied units).
- **Block group 080310008001 low-mod:** 1,350 of 1,400 (96.4%, MOE ±4.6 pts), ACS 2016–2020.
- **Denver County designations:** QCT 2026 — 40 tracts (`STATE='08' AND COUNTY='031'`);
  Opportunity Zones — 10 (`GEOID10 LIKE '08031%'`).
- **Denver County inventories:** LIHTC 184 properties (`STATE2KX='8' AND CNTY2KX='31'`); public
  housing developments 29 and assisted multifamily 99 (`STATE2KX='08' AND CNTY2KX='031'`).
- **Metropolitan Denver CoC (CO-503):** sheltered 7,324, unsheltered 81, sheltered veterans
  390, unsheltered veterans 257 — year not stated in the layer.

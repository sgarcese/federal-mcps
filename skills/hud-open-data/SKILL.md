---
name: hud-open-data
description: Answer housing questions for a U.S. county, city, tract or ZIP from HUD's ArcGIS Hub open data (Fair Market Rents and Small Area FMRs, Housing Choice Vouchers by tract, low-and-moderate-income shares, Qualified Census Tracts, Difficult Development Areas, LIHTC properties, public housing, assisted multifamily, Continuum of Care areas) with the right dataset, layer, join key and vintage. Use with geo_resolve_place and an OpenContext ArcGIS connector for data.hud.gov. For Fair Market Rents, Income Limits and MTSP limits, CHAS cost burden and the Picture of Subsidized Households by place, use the HUD User server (hud-user.responsive.city, hud_get_indicator) instead.
---

# HUD Open Data (ArcGIS Hub) source guide

HUD publishes its geospatial open data on ArcGIS Hub (`data.hud.gov`,
`hudgis-hud.opendata.arcgis.com`; 103 feature services). Verified live on 2026-09-20. Federal
public data; every item carries HUD's no-warranty statement — cite "U.S. Department of Housing
and Urban Development, <dataset name>, HUD Open Data (ArcGIS Hub), accessed <date>".

## Which source answers

HUD is two sources. **The HUD User server** (`https://hud-user.responsive.city/mcp`,
`hud_resolve_place` → `hud_get_indicator` / `hud_compare_places`) answers Fair Market Rents by
bedroom count, Income Limits and area median income, MTSP limits, CHAS cost burden (renters and
owners, over 30% or over 50% of income) and the Picture of Subsidized Households, each with its
fiscal year or release and HUD User's citation; `hud_get_raw` returns an endpoint's JSON unchanged
(every Small Area FMR ZIP in a county: `{endpoint: "fmr", ids: ["<county FIPS>99999"]}`). Prefer it
for those questions — it builds HUD's ids for you. **This guide** covers the Hub's geospatial
datasets: vouchers by tract, low-mod shares, QCTs, DDAs, LIHTC, public housing, assisted
multifamily, Opportunity Zones and Continuum of Care areas. CHAS is also on the Hub as a raw
ACS special tabulation (below) — prefer HUD User's curated cost-burden measures; use the Hub
table only for a field the curated indicator doesn't surface. FMR rows below remain for
sessions without the HUD User server.

## Tools you need

- `geo_resolve_place` (federal-mcps geo server): candidates with `geoid`, parents (county,
  CBSA/metro) — HUD keys are built from these.
- An OpenContext ArcGIS connector on `https://data.hud.gov` (`arcgis__search_datasets`,
  `arcgis__get_dataset`, `arcgis__get_schema`, `arcgis__query_data {dataset_id, where,
  out_fields, limit, offset, order_by, layer, format}`, `arcgis__aggregate_data`).
  The family's deployment at **`https://hud.responsive.city/mcp`** runs the OpenContext build
  pinned in `opencontext.lock.json` (#295, 2026-09-30): `query_data` returns every matching
  row up to `limit` (paged with `offset`, ordered with `order_by`, as `json`/`csv` as well as
  text, no fixed 10-row display cap), `layer` selects among a service's layers/tables (fixes
  Small Area FMR table 1, CHAS county layer 4, below), `aggregate_data` runs server-side
  statistics/group-by, and `get_schema`/`get_dataset` return full descriptions, edit dates and
  field domains when a layer declares them (none of the LIHTC/Public Housing/Multifamily
  layers do — see the code-table links below). Field names below still save a call.

## Datasets (Hub item id · what the key is)

| Dataset | Item id | Key | Key fields | Vintage |
|---|---|---|---|---|
| Fair Market Rents | `12d2516901f947b5bb4da4e780e35f07` | `FMR_CODE` (see below); no FIPS column | `FMR_AREANAME`, `FMR_0BDR`…`FMR_4BDR` | FY2026 (effective 2025-10-01) |
| Small Area FMRs (ZIP) | `6458c67bad2a4cc7aa97514ef7ba8a0e` | values are in **table layer 1** keyed `ID` = ZIP, `HUD_CODE`; layer 0 is ZCTA geometry only, and the connector resolves the first *layer*, so SAFMR values are still not reachable here — use `hud_get_raw` on the HUD User server | `SAFMR_2BR`, `*_90_Payment_Standard`, `*_110_Payment_Standard` | FY2026 |
| Housing Choice Vouchers by Tract | `8d45c34f7f64433586ef6a448d00ca12` | `GEOID` (11-digit tract) | `HCV_PUBLIC` voucher households (null = tract has ≤10 voucher households, per HUD's description; a county sum over non-null tracts is a **floor**, verified 2026-09-30: Denver County 9,298 across 143 of 178 tracts, 35 suppressed); `HCV_PUBLIC_PCT` = % of renter-occupied units (2020 Census DHC H4) | current PIH extract |
| ACS 5YR CHAS Estimate Data (state, county, place, tract) | county `dbcc9ba4a4144a6d823b4d429d2b97c6` (layer **4**; verified 2026-09-30: Denver `GEOID='08031'` → `T2_EST1` 287,755 households), tract `db5099395be44cbd8c6896136dbd5e7e`, place `35665594f7364a76b1ba7e63eb59d2a5`, state `35f3c8985bc7407ba0fe8f7b2291f5c0` | `GEOID` (plus separate `STATE`/`COUNTY` fields on the county layer) | about 408 columns (`T2_EST1`…`T8_EST69`…) meaningless without [HUD's CHAS data dictionary](https://www.huduser.gov/portal/datasets/cp/CHAS/data_doc_chas.html) (2026-09-30) | **2016–2020 ACS** special tabulation (per the layer description) |
| Low-Mod Income Population by Block Group | `09eceb08d95d429dae9f88fe39826bf1` | `GEOID` (12-digit) | `Lowmod`, `Lowmoduniv` (strings with commas), `Lowmod_pct` (0–1), `MOE_LOWMOD_PCT` (+/-x%), `Source` | "ACS 2020-2016" (2016–2020 ACS) |
| Low-Mod Income Population by Tract | `3bd6767dcc5e4937a6232d9db04dd447` | `GEOID` | `LOWMODPCT` (0–100) | its only layer is id 4; reachable since the 2026-09-22 connector fix (tract 08031000800 → 100) |
| Qualified Census Tracts 2026 | `f55f80843c9a436ba8e578a54cdd8cea` | `GEOID`, `STATE`, `COUNTY` (padded) | presence = QCT | 2026 designation |
| Difficult Development Areas 2026 | `87d645f216024a07936c0f8bb0f20366` | `ZCTA5` | `DDA_CODE`, `DDA_TYPE`, `DDA_NAME` | 2026 |
| LIHTC Properties | `810ccb34dd464ec4ad4697d35fff21a5` | `STATE2KX`, `CNTY2KX` **unpadded strings** (`'8'`, `'31'`), `PLACE2KX` 5-digit, `TRACT2KX`; **also `COUNTY_LEVEL`, `PLACE_LEVEL` — unpadded too** (Denver: `COUNTY_LEVEL='8031'`, `PLACE_LEVEL='820000'`, both 184 rows; padded `'08031'`/`'0820000'` return 0; verified 2026-09-24) | `PROJECT`, `LI_UNITS`, `N_UNITS`; `YR_PIS`/`YR_ALLOC` carry sentinels **`8888`**/**`9999`** (not-yet-placed-in-service / allocated-not-placed; nationally 3,109/969 rows per the 2026-09-24 spike) — never average or report as a real year; rows with `LI_UNITS > N_UNITS` (360 nationally) and repeated addresses (an `8888` row plus its placed-in-service twin) need a caveat, not a silent sum; `CREDIT`, `TYPE`, `NON_PROF`, `TRGT_*`, `QCT`, `DDA` are coded fields with no ArcGIS domain — codes are in [HUD's LIHTC data dictionary](https://www.huduser.gov/portal/datasets/lihtc/property.html) ("LIHTC Data Dictionary", 2026-09-30), not guessable from the field name | current HUD LIHTC database |
| Public Housing Developments | `5c96143f79c940a0a8cedae99a1ac562` | `STATE2KX`, `CNTY2KX` **zero-padded** (`'08'`, `'031'`), `PLACE2KX` | `PROJECT_NAME`, `TOTAL_UNITS`, `PCT_OCCUPIED`; resident-mix `PCT_*`/`HH_INCOME` are **suppressed to `-4`** when `Number_Reported` ≤ 10 (HUD's field description; verified live 2026-09-30: Denver's "Walsh Manor Annex" carries `PCT_BLACK=-4, HH_INCOME=-4`) — report `-4` as suppressed, never as a value | current PIH extract |
| Multifamily Properties – Assisted | `f4721da932a94b218bdb5a861fd7429e` | `STATE2KX`, `CNTY2KX` zero-padded | `PROPERTY_NAME_TEXT`, `TOTAL_ASSISTED_UNIT_COUNT`, `TOTAL_UNIT_COUNT` | current |
| Opportunity Zones | `ef143299845841f8abb95969c01f88b5` | `GEOID10` (2010 tracts) | — | only layer is id 13; reachable since the 2026-09-22 connector fix |
| Continuum of Care Grantee Areas | `c930d736b1764c259371fc7111e02740` | `COCNUM` (`CO-503`), `COCNAME` | PIT counts `SH_PERS_HWAC`, `UNSH_PERS_HWAC`, `SH_VETS`, `UNSH_VETS`, `SH_CH`, `UNSH_CH` | **`YEAR` is null** in the layer — say the count year is not stated; HUD Exchange has dated PIT reports |

**Not on the Hub** (say so; do not substitute): the Picture of Subsidized Households, Income
Limits, MTSP limits, FMR history by fiscal year, and Small Area FMR ZIP tables. These are all
HUD User sources — answer from the family's HUD User server (`packages/server-hud`,
`https://hud-user.responsive.city/mcp`): `hud_resolve_place` → `hud_get_indicator` /
`hud_compare_places` for FMR, Income Limits/MTSP, CHAS and Picture; `hud_get_raw {endpoint:
"picture"|"fmr"|"il"|"mtspil"|"chas", ...}` for raw fields; `hud_describe_source` lists every
program. PIT counts by year: HUD Exchange (not the Hub or HUD User).

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
- Never pad `COUNTY_LEVEL` or `PLACE_LEVEL` on LIHTC either — they are unpadded too (verified
  2026-09-24: Denver `COUNTY_LEVEL='8031'`, `PLACE_LEVEL='820000'`, 184 rows each;
  `'08031'`/`'0820000'` return 0). Public Housing Developments uses the padded forms
  (`'08031'`, `'0820000'`) for its own county/place columns — don't carry LIHTC's padding
  there either. Padding either way silently returns zero LIHTC properties in every state
  with FIPS < 10 (AL, AK, AZ, AR, CA, CO, CT, DE, DC). Safe filter: `COUNTY_LEVEL =
  '<FIPS without leading zero>'` (or `PLACE_LEVEL` unpadded), or `STATE2KX`+`CNTY2KX`
  unpadded — never the padded shape on this dataset
  ([spike: the HUD surface](../../docs/spikes/hud-surface-cost-benefit.md) costs
  normalising these codes server-side as one surface option; #215).
- Never sum `LI_UNITS` as "affordable units in the city" without saying LIHTC only, and that
  `NONPROG` rows may have left the program.
- Never report a CoC PIT count as this year's without saying the layer carries no year.
- Never call FMR a market rent: it is the 40th-percentile gross rent HUD sets for vouchers.
- Never treat "Low-Mod" as poverty: it is ≤80% of area median income (CDBG definition).
- Never report a county/place voucher sum as the total: tracts with ≤10 voucher households are
  null, so the sum over non-null tracts is a floor — say so.
- Never report `-4` on Public Housing resident-mix fields (`PCT_*`, `HH_INCOME`) as a value:
  it means the underlying count was ≤10 and HUD suppressed it.
- Never report LIHTC `YR_PIS`/`YR_ALLOC` `8888`/`9999` as a year, or a `CREDIT`/`TYPE`/
  `NON_PROF`/`TRGT_*`/`QCT`/`DDA` code as self-evident — look it up in HUD's LIHTC data
  dictionary (link above).
- Never answer Picture of Subsidized Households, Income Limits, FMR history or SAFMR tables
  from the Hub: they are not there. Say so and point to the HUD User server.

## Worked examples

Verified 2026-09-20:


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

Verified 2026-09-30:

- **Denver County CHAS households:** `T2_EST1` 287,755 (`GEOID='08031'`, layer 4) — 2016–2020
  ACS special tabulation; any other field needs the CHAS data dictionary.
- **Denver County voucher households, a floor:** 9,298 summed across 143 of 178 tracts
  (`GEOID LIKE '08031%'`); the other 35 tracts are null (≤10 voucher households each).
- **Denver public housing suppression:** "Walsh Manor Annex" (`STATE2KX='08' AND
  CNTY2KX='031'`) carries `PCT_BLACK=-4, HH_INCOME=-4` — suppressed, not a value.
- **Picture of Subsidized Households, Income Limits, FMR history, SAFMR tables:** not on the
  Hub — answer from the HUD User server.

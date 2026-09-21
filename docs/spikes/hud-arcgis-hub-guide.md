# Spike: HUD Open Data on ArcGIS Hub — verification for the HUD source guide

The owner deploys `data.hud.gov` (HUD's ArcGIS Hub, `hudgis-hud.opendata.arcgis.com`, 103
feature services) on OpenContext's ArcGIS plugin. This spike verifies, live on 2026-09-20, the
datasets a place-level source guide needs, their join keys, and what the connector can and
cannot reach. The guide itself is `skills/hud-open-data/SKILL.md` (#192).

## Datasets verified (Hub item id · layer · join key · notes)

| Dataset | Item id | Layer | Join key | Verified facts |
|---|---|---|---|---|
| Fair Market Rents | `12d2516901f947b5bb4da4e780e35f07` | 0 | `FMR_CODE` (no FIPS column) | FY2026 (effective Oct 1); 2,622 areas; codes `METRO<cbsa>M<cbsa>` (Denver `METRO19740M19740`: 0BR 1,643 · 1BR 1,754 · 2BR 2,089), HUD Metro FMR sub-areas `METRO<cbsa>MM<code>` / `METRO<cbsa>N<fips>`, nonmetro `NCNTY<fips>N<fips>`; no other shapes |
| Small Area FMRs | `6458c67bad2a4cc7aa97514ef7ba8a0e` | table **1** (`SAFMR_table`, keyed `ID` = ZIP, `HUD_CODE`); layer 0 is ZCTA geometry only | ZIP | SAFMR_0BR…4BR plus 90%/110% payment standards |
| Housing Choice Vouchers by Tract | `8d45c34f7f64433586ef6a448d00ca12` | 0 | `GEOID` (11-digit) | `HCV_PUBLIC` = voucher households; `HCV_PUBLIC_PCT` = % of renter-occupied units (2020 DHC table H4); tract 08031000800 → 429 |
| Low-Mod Income Population by Block Group | `09eceb08d95d429dae9f88fe39826bf1` | 0 | `GEOID` (12-digit) | `Source` "ACS 2020-2016"; `Lowmod`, `Lowmoduniv` (strings with commas), `Lowmod_pct` (0–1), `MOE_LOWMOD_PCT` ("+/-4.60%") |
| Low-Mod Income Population by Tract | `3bd6767dcc5e4937a6232d9db04dd447` | **4** (only layer) | `GEOID` | `LOWMOD`, `LOWMODUNIV`, `LOWMODPCT` (0–100); **unreachable through the connector** (layer 0 hardcoded) |
| Qualified Census Tracts 2026 | `f55f80843c9a436ba8e578a54cdd8cea` | 0 | `GEOID`, `STATE`, `COUNTY` | Denver County: 40 tracts |
| Difficult Development Areas 2026 | `87d645f216024a07936c0f8bb0f20366` | 0 | `ZCTA5` (metro DDAs are ZIP-based) | `DDA_CODE`, `DDA_TYPE`, `DDA_NAME` |
| Opportunity Zones | `ef143299845841f8abb95969c01f88b5` | **13** (only layer) | `GEOID10` (2010 tracts) | Denver County: 10; **unreachable through the connector** |
| LIHTC Properties | `810ccb34dd464ec4ad4697d35fff21a5` | 0 | `STATE2KX` + `CNTY2KX` **unpadded strings** (`'8'`,`'31'`); `PLACE2KX` 5-digit | Denver County: 184; `LI_UNITS`, `N_UNITS`, `YR_PIS`, `QCT`, `DDA` |
| Public Housing Developments | `5c96143f79c940a0a8cedae99a1ac562` | 0 | `STATE2KX` + `CNTY2KX` **zero-padded** (`'08'`,`'031'`) | Denver County: 29; `TOTAL_UNITS`, occupancy and resident-mix percentages |
| Multifamily Properties – Assisted | `f4721da932a94b218bdb5a861fd7429e` | 0 | `STATE2KX` + `CNTY2KX` zero-padded | Denver County: 99; `TOTAL_ASSISTED_UNIT_COUNT`, `TOTAL_UNIT_COUNT` |
| Continuum of Care Grantee Areas | `c930d736b1764c259371fc7111e02740` | 0 | `COCNUM` (`CO-503`) | Carries PIT counts (`SH_PERS_HWAC`, `UNSH_PERS_HWAC`, veterans, chronic) but **`YEAR` and `STUSAB` are null**: the count year is not in the layer |

**Not on the Hub:** Income Limits (huduser.gov API), PIT counts by year (HUD Exchange),
Picture of Subsidized Households. Say so rather than substituting.

**Licence text on every item:** HUD's no-warranty statement; public federal data.

## Connector findings (OpenContext ArcGIS plugin, deployed HUD instance)

1. `get_schema` fails on **every** dataset with `Expecting value: line 1 column 1` (the layer
   metadata response is not parsed as JSON). Field names in the guide are therefore taken from
   the feature services directly and documented; `query_data` with `out_fields` works.
2. `_ensure_layer_url` appends `/0`: a service whose only layer has another id (Low-Mod by Tract
   = 4, Opportunity Zones = 13) fails with `Invalid URL`. Fix upstream: read `layers[0].id` from
   `FeatureServer?f=json`; also expose tables (SAFMR values live in table 1).
3. Search works well: the place-level datasets rank first for natural queries.

Both bugs are the owner's to file upstream (ADR-015 §6).

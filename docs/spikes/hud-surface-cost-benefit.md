# Spike: the HUD surface — generic connector, fork fixes, a dedicated server, or a hybrid

**Question.** The owner built a South Bend housing dashboard (five counties: St. Joseph, Elkhart,
LaPorte, Marshall IN and Berrien MI) against the live HUD connector at
`https://hud.responsive.city/mcp` and filed 17 issues. Should HUD data be served by
**(A)** the current generic OpenContext ArcGIS provider plus the `hud-open-data` skill,
**(B)** targeted fixes contributed to the owner's OpenContext fork, **(C)** a dedicated
`server-hud` on the federal-mcps core, or **(D)** a hybrid? ADR-015 §2's server test decides it.

**Method (2026-09-24).** Read the ArcGIS plugin (`sgarcese/OpenContext` `main` = `b7eae5d`, the
commit `opencontext.lock.json` pins) and its base class; reproduced issues against the live
connector (JSON-RPC `tools/call`) and against the HUD feature services under
`services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/` (count-only and statistics queries,
about 45 requests in all); read the HUD User API documentation and terms, and the Picture of
Subsidized Households page; read the dashboard's working notes and pulled files
(`~/Dev/Harvard/housing-dashboard/`). No HUD User token is configured anywhere, so **HUD User
API responses were not called**: facts about them come from HUD's documentation and are marked
*docs*. Nothing was written to either repository.

## Verified facts (2026-09-24 unless stated)

### The connector

- **What `hud.responsive.city` runs.** The data-smart wrapper (`~/data-smart-connected-mcps`)
  vendors an OpenContext snapshot; its latest commit `c7b19c0` synced fork PR #26 (layer
  resolution, `f=json` schema, schema fallback). Nine of its 17 portals are ArcGIS
  (`prod-mcps-urls.csv`), so a generic ArcGIS fix reaches all nine at the next sync.
- **Five tools**: `search_datasets`, `get_dataset`, `get_aggregations` (Hub *catalog* facets:
  type, tags, categories, access; not data), `get_schema`, `query_data {dataset_id, where,
  out_fields, limit}`. No offset, order, layer, statistics, geometry or format argument.
- **Ten records shown, whatever the limit** (#1). `_format_query_results` calls
  `BaseOpenDataPlugin.format_records`, whose `max_display` defaults to **10**; ArcGIS does not
  override it. Live: LIHTC `STATE2KX='18' AND CNTY2KX='141'`, `limit: 50` → header "Returned 39
  record(s) (limit: 50)", Records 1–10, then "... and 29 more record(s)". The query itself asks
  for `min(limit, 1000)`; the LIHTC layer's `maxRecordCount` is 2,000; `exceededTransferLimit`
  is never read, so a truncated server page is not reported either.
- **Text only** (#2). Every result is `Record N:` text inside untrusted-content markers
  (`frame_portal_content`), capped at `DEFAULT_MAX_RESPONSE` = 60,000 characters. OpenContext
  has no `structuredContent` path.
- **Layer choice** (#5). `_resolve_layer_url` takes the first entry of `layers + tables`. The
  Small Area FMR service has `layers [(0, SAFMR_Zip_Code_Tab_Areas)]` and
  `tables [(1, SAFMR_table)]`, so the connector always lands on the geometry layer (live
  `get_schema` shows only ZCTA fields). Table 1 answers directly: `ID='46601'` →
  `HUD_CODE` `METRO43780M43780`, `SAFMR_2BR` **1,060** (90%: 954, 110%: 1,166); 51,895 rows.
- **Descriptions cut at 300 characters, HTML included** (#8). `_extract_dataset_summary`
  truncates `description` to 300 chars, and `get_dataset` reuses it. The LIHTC description
  shown live is about 40 words of style attributes then "Created by the Tax Reform Act of 1986,
  the Low-Income Housin...". The Hub API returns the whole text (Housing Choice Vouchers: 2,304
  chars; Public Housing Developments: 3,023).
- **Geometry** (#13): `returnGeometry` is hard-coded `"false"`.
- **Feature services support what the connector does not expose.** LIHTC layer:
  `supportsStatistics: true`, pagination and `orderBy` supported. One statistics call with
  `groupByFieldsForStatistics=COUNTY` over the ring's 222 voucher tracts returned per-county
  sums, non-null counts and tract counts — what took the dashboard 23 paged calls.
- **Sibling plugins already page and aggregate** (Socrata, CKAN, OpenDataSoft carry offset;
  CKAN and Philly expose `aggregate_data`), so the missing ArcGIS features are parity work.

### HUD data properties (not connector bugs)

- **County/place code shapes differ by layer** (#6). LIHTC: `COUNTY_LEVEL='8031'` → 184,
  `'08031'` → **0**; `PLACE_LEVEL='820000'` → 184, `'0820000'` → 0; `STATE2KX='8' AND
  CNTY2KX='31'` → 184, padded → 0. Public Housing Developments and Multifamily Assisted:
  `COUNTY_LEVEL='08031'` → 29 and 99; `'8031'` → 0. The South Bend ring is unaffected (IN 18,
  MI 26): `COUNTY_LEVEL='18141'` → 39, `'26021'` → 26. Already filed for the guide as **#215**.
- **No coded-value domains** (#9). No field on LIHTC or Public Housing carries an ArcGIS
  `domain`. The item metadata XML (92 KB, 119 attribute labels) defines each field in words
  ("Type of credit percentage") but not its codes: `CREDIT` takes `1` 12,393 · `2` 19,529 ·
  `3` 4,716 · `4` 1,363 · null 12,565, and "8888" appears nowhere. The code tables are in
  HUD's LIHTC data dictionary on huduser.gov: HUD knowledge, wherever it lives.
- **No fiscal year in the data** (#10). FMR fields: `OBJECTID, FMR_CODE, FMR_AREANAME,
  FMR_0BDR…FMR_4BDR, Shape__Area, Shape__Length`; `editingInfo.dataLastEditDate`
  1759276162016 (2025-09-30 UTC). The layer's metadata dates are generic; "FY2026" is HUD
  knowledge (effective 1 October).
- **Suppression rules are in the descriptions the connector cuts** (#12).
  Housing Choice Vouchers: "tracts containing 10 or fewer voucher holders have been omitted".
  In the ring, 139 of 222 tracts carry null `HCV_PUBLIC`, and the non-null sums (St. Joseph
  2,609 in 45 of 82 tracts; Elkhart 767, 17 of 45; LaPorte 207, 6 of 30; Marshall 53, 2 of 12;
  Berrien 683, 13 of 53) are floors. Public Housing: characteristics "are suppressed with a -4
  value when the Number_Reported is equal to, or less than 10": 529 of 6,211 developments
  nationally carry `-4` (`PCT_BLACK`, `HH_INCOME`). With (#8) fixed, the connector would show
  both rules; the model still has to apply them.
- **LIHTC anomalies** (#16). Nationally, of 50,566 records: `YR_PIS='8888'` 3,109,
  `'9999'` 969, `LI_UNITS > N_UNITS` 360. In the ring (102 records): 8 with `8888`, 1 with
  `LI_UNITS > N_UNITS`, and 11 addresses with more than one record. Some of those are
  legitimate phases, so "duplicate" needs HUD's definition. *Not verified:* how many are true
  twins.
- **FMR area codes** (#15). FY2026 ring: `METRO43780M43780` South Bend-Mishawaka HMFA 2BR
  **1,292**; `METRO21140M21140` Elkhart-Goshen **1,183**; `METRO33140M33140` Michigan City-La
  Porte **1,152**; `METRO35660M35660` Niles MI **1,184**; `NCNTY18099N18099` Marshall County
  **1,008**. Values match the dashboard's `fmr.json`.

### Datasets the field report called missing

- **CHAS is on the Hub** (correction to #7 and #17). Search "CHAS" live returns four services:
  county `dbcc9ba4a4144a6d823b4d429d2b97c6`, tract `db5099395be44cbd8c6896136dbd5e7e`, place
  `35665594f7364a76b1ba7e63eb59d2a5`, state `35f3c8985bc7407ba0fe8f7b2291f5c0`. The county
  service's only layer is **id 4**, and it is reachable through the connector since #26: a live
  `query_data` gave St. Joseph `T2_EST1` 104,380 and Berrien 63,135. But it has **408 opaque
  columns** (`T8_EST69`, `T3_EST47` …) that mean nothing without HUD's CHAS data dictionary, and
  its vintage is **2016–2020 ACS** (per the description). A newer CHAS release on huduser.gov is
  *not verified*.
- **Not on the Hub** (search misses, #17): Picture of Subsidized Households (search returns
  "Low Vacancy Areas – Set-Aside Tenant Protection Vouchers"); Income Limits (search returns
  Low-Mod layers); FMR history by fiscal year; the USPS ZIP crosswalk.
- **HUD User API** (*docs*): base `https://www.huduser.gov/hudapi/public/`. An unauthenticated
  call returns HTTP **401** `{"error":"Unauthenticated"}` (verified). Free account, per-dataset
  registration, `Authorization: Bearer <token>`. **Terms:** "The limit on the maximum number of
  API calls is **60 queries a min**"; attribution required: *"This product uses the HUD User
  Data API but is not endorsed or certified by HUD User."*; no modifying content while citing
  HUD User; access revocable. Endpoints and identifiers:
  - FMR `fmr/data/{entityid}` (county, NE town or metro), `fmr/statedata/{state}`,
    `?year=` (default latest; the docs' example is 2017). Entity ids: county = 5-digit FIPS +
    `99999` (`0801499999`, `5100199999`), NE town = FIPS + county-subdivision code
    (`5002175925`), metro = `METRO<cbsa>M<cbsa>` / `METRO<cbsa>N<fips>` (the Hub's `FMR_CODE`
    grammar). A Small Area FMR metro returns one row per ZIP plus "MSA level".
  - Income Limits `il/data/{entityid}`, `il/statedata/{state}`, MTSP `mtspil/data/{entityid}`;
    the IL 2025 county FIPS changed in some states (`listCounties/CT?updated=2025`).
  - CHAS `chas?type=1–5&stateId=<unpadded number>&entityId=<from chas/listCounties>&year=`;
    nation, state, county, MCD, place; variables A1…J (HUD-summarised); the docs list year
    ranges up to 2014–2018 (*possibly stale docs; not verified*).
  - Picture of Subsidized Households `picture?type=1–11&census=2010|2020&year=2012–2024
    &statecode=&entityid=&program=`: nation, state, PHA, CBSA, project, tract, city, county,
    ZIP, congressional district, by program; `census=2010` for 2012–2021, `2020` for 2023+.
  - USPS crosswalk `usps?type=1–12&query=<zip|tract|county|cbsa|…>&year=&quarter=`.
- **Picture of Subsidized Households files**: annual XLSX by level for **2009–2025** (194
  links), ten levels (US, state, CBSA, PHA, project, tract in two halves, place, county, CD,
  ZIP). `COUNTY_2025_2020census.xlsx` 9,656,079 bytes, `PROJECT_2025` 17,479,061,
  `TRACT_AK_MN_2025` 70,592,798; all last modified **2026-02-18**. The files run a year ahead
  of the API's documented 2012–2024.

### What a dedicated server gets from the core (read from `packages/core/src`)

Envelope with `source.citation`, `vintage`, `footnotes`, `limitations`, `cache`; HTTP client
with retry/backoff, cache, fixture record/replay and `queryAuth` (a key kept out of cache keys,
fixtures and logs); a budget store that is **per UTC day** (`BudgetStore.consume`), with no
per-minute limiter; the indicator registry and `get_indicator`/`compare_places`/
`list_indicators` tools (726 lines); `resolve_place` over the catalog with agency-code columns;
the contract suite. Open **#210**: core text rendering cuts the data line at 4,000 characters
(`structuredContent` stays whole). A HUD server would inherit it.

### The cost of the last server (M8, by count)

Spike 2026-09-18 → ADR-014 2026-09-19 → **7 build issues + epic**, closed 2026-09-19/20 through
**10 PRs** (including a core refactor lifting the registry for a second agency) →
`server-census` **1,593** source lines + **1,125** test lines, a Terraform instance, a key,
nine eval cases, v0.3.0. By comparison, the last ArcGIS fork fix (PR #26) was 685 insertions
across 14 files, 368 of them tests. M9's two guides cost 3 issues.

## The 17 issues, classified

Class: **G** = generic plugin limitation (fixable once for every ArcGIS portal), **H** = HUD data
property (needs HUD knowledge wherever it lives), **M** = missing source (not on the Hub).
Effort is in issue units (1 ≈ one M8 build issue).

| # | Issue | Class | Evidence | Fixed by | Effort |
|---|---|---|---|---|---|
| 1 | 10 records shown | G | `format_records(max_display=10)` | B | ¼ (in O1) |
| 2 | Text only | G | no JSON/CSV; 60k framed cap | B (CSV/JSON inside the frame); C (envelope + `structuredContent`) | ¼ (O1) |
| 3 | No offset/order | G | not in schema; layer supports both | B | ¼ (O1) |
| 4 | No statistics/groupBy | G | layer `supportsStatistics`; verified | B | 1 (O3) |
| 5 | Layer 0/first layer only | G | SAFMR table 1 unreachable | B (`layer` arg); C/D (SAFMR via FMR API) | ½ (O2) |
| 6 | County code padding | H | LIHTC `8031` vs `08031` elsewhere | A (#215, filed); C normalises | ¼ |
| 7 | PSH, IL, FMR history, SAFMR tables, crosswalk missing | M (CHAS: on Hub, opaque) | search misses; HUD User API | C or D | 4–5 (server) |
| 8 | Truncated HTML descriptions | G | 300-char cut, raw HTML | B | ½ (O4) |
| 9 | No code domains | H | no domains in the service or metadata XML | A (code tables in guide) or C (decoded) | ¼ A / in C |
| 10 | No vintage/FY | H (+G: `dataLastEditDate` not shown) | no FY field | A states FY; B shows edit dates; C sets `vintage` | ¼ |
| 11 | No provenance block | G/H | connector has no envelope | B partial (source URL, dates, licence); C full | ¼ B / in C |
| 12 | Suppression undocumented | H, **hidden by #8** | rules are in the full descriptions | B surfaces; A states; C flags per value | ¼ |
| 13 | No geometry | G | `returnGeometry: false` | B (optional, simplified) | ½ (defer) |
| 14 | No geography helper | H | each layer keys differently | A (recipe); C (`resolve_place` → keys) | in C |
| 15 | County → FMR area | H | code grammar | catalog column (helps A and C); HUD User `fmr/data/{fips}99999` | ½–1 |
| 16 | LIHTC duplicates, `LI_UNITS > N_UNITS` | H | 8888: 3,109; `LI>N`: 360 | A (guide rule); C (caveat) | ¼ |
| 17 | Search misses PSH, CHAS | M (PSH) / wrong (CHAS found) | live search | A (name the non-Hub sources); D serves PSH | ¼ |

**Tally:** generic 7 (#1–5, #8, #13), HUD property 7 (#6, #9, #10, #12, #14–16), missing
source 2 (#7, #17), and #11 split between generic and HUD. Six of the seven generic items are what made the
dashboard cost 47 calls and hand transcription. The HUD-property items are guide text today;
none of them needs a server to be stated, only to be *enforced*.

## The options, costed

| | A: guide only | B: fork fixes (+A) | C: `server-hud` (everything) | D: hybrid (B + A for Hub; server for HUD User API) |
|---|---|---|---|---|
| **Build** | 1–2 units (#215 + one guide issue) | +4 fork PRs (O1–O4), each about #26's size, + one data-smart sync | ~10–12 units: M8's 7, plus ArcGIS layer adapters for ~8 Hub layers, a per-minute limiter in core, two upstreams | B (4) + ~7–8 server units (HUD User only) |
| **Fixes** | 6, 9, 10, 12, 14, 16, 17 as text | + 1–5, 8, 11 (part), 13 | all 17 | all 17 |
| **Maintenance** | Re-verify each FY (FMR 1 Oct, QCT/DDA, IL) | + fork divergence from `thealphacubicle`; data-smart snapshot sync is manual | + FY rollover of FMR/IL, annual PSH/CHAS vintages, fixture re-records, HUD API changes (the IL 2025 FIPS change), Hub schema drift across ~8 layers | Server tracks HUD User only (FY rollovers, PSH/CHAS vintages); Hub drift stays in the guide |
| **Ops** | none | a data-smart redeploy (owner) | Lambda + domain + exec role (admin script), `HUD_USER_TOKEN` sensitive var, one token shared by all users at 60/min | same as C, smaller server |
| **Family gains** | geography via `geo_resolve_place` | none new; 9 ArcGIS portals improve | envelope, HUD citation + required sentence, caveats per value, contract suite, catalog keys, composite mount, evals | same as C for the HUD User datasets; the Hub layers stay guide-grade |

**Hostname collision.** `hud.responsive.city` is the data-smart portal. A server needs another
name (for example `huduser.responsive.city`), or the portal moves. That is the owner's call.

**Quota.** The core budget counts per day; HUD User's limit is 60 per **minute**, per token, and
a deployed server shares one token across every user. A token-bucket limiter in the core HTTP
client (with the long-TTL cache that immutable FY data allows) is required, and it is a core
change: every server would get it.

## Benefit for the South Bend workflow

Measured today (dashboard notes, 2026-09-23): six Hub datasets took **~47 `query_data` calls**
(multifamily 8, LIHTC 11, public housing 3, PHAs 1, voucher tracts 23, FMR 1), each page saved
verbatim and regex-parsed (`hud_parse.py`), paging on `OBJECTID > last`. SAFMR, Picture of
Subsidized Households, Income Limits, FMR history and CHAS were not obtained. The dashboard's
own skill keeps a "direct path" (`pull_hud.py`, `resultOffset` against services.arcgis.com)
that bypasses the connector.

| | Calls for the six Hub datasets | County totals | Missing sources | Transcription |
|---|---|---|---|---|
| A | ~47 (unchanged) | client-side | none reachable; CHAS reachable but opaque | every row, by hand/regex |
| B | ~6 (one per dataset: ≤1,000 rows in one call; the ring's largest is 222) | 1 statistics call per measure (verified: 5-county HCV sums in one call) | SAFMR via `layer: 1`: +1; PSH/IL/history still none | CSV/JSON inside the text frame: parse, not transcribe |
| C | ~6 raw calls for property-level points, or 0 when only totals are needed | ~8 `compare_places` calls (FMR 2BR, vouchers, LIHTC units, assisted units, public housing units, IL, CHAS cost burden, PSH totals), each with caveats and citation | FMR history: 2 `statedata` calls per year (IN, MI); PSH, IL, CHAS: 1 each | none: envelope + `structuredContent` |
| D | ~6 (B) | Hub totals by statistics calls; HUD User measures by `compare_places` | as C | Hub: parse CSV; HUD User: none |

B removes about 40 of the 47 calls and all the transcription for the data the dashboard already
had. D adds the datasets the owner called "the best single source for a dashboard" (PSH), plus
Income Limits and FMR history.

## Applying ADR-015's server test

ADR-015 chooses the surface **per source**. HUD is two sources, and the test gives a different
answer for each.

- **HUD Open Data (ArcGIS Hub).** *Id grammar:* no. The where-clause is the grammar, as SoQL is
  for PLACES; the one grammar-like hazard (code padding, FMR codes) is a few lines of guide text
  and a catalog column. *Quota/caching:* none published for public hosted layers, and the
  connector already sends one request per call. *Host relies on the contract:* weakly; citation
  and dates can be added generically. → **Guide + connector stands**, but the connector must be
  fixed. Unlike the PLACES benchmark, where the failures were policy, the field report's
  high-impact failures are **access** failures. No guide can page past a hard-coded 10-record
  display. ADR-015 §6 already sends these upstream.
- **HUD User API.** It is not portal-hosted (no Socrata/CKAN/ArcGIS/ODS front, and no OpenContext
  plugin type fits), so ADR-015's default does not apply. It also meets **all three** server
  conditions. *Id grammar:* county entity ids `SSCCC99999`, NE-town ids, `METRO…M…`/`NCNTY…N…`,
  CHAS's unpadded `stateId` plus lookup-only `entityId`, and Picture's `type` 1–11 with the
  census-2010/2020 rule by year. *Quota:* a token and 60 per minute. *Contract:* citations and
  caveats are what the dashboard needed, and the terms require a displayed sentence exactly
  as Census's did (ADR-014 §11).

**Does the evidence argue for amending ADR-015?** Not its rule; its **wording for HUD**.
§2 says "CDC PLACES and HUD are guides". It should say "HUD Open Data (ArcGIS Hub) is a guide;
the HUD User API is decided by the server test", and the consequence "if usage shows the guide
is not enough, re-run the test" has now been exercised. A useful addition to §6: a connector
limitation that blocks *access* (not policy) is a release blocker for the guide, and gets a
guided-run eval case that fails until it is fixed.

## Recommendation

**D, sequenced so the smallest unblocking step lands first.**

1. **Now (days): make the Hub path honest.** Fix #215, and add one guide issue: CHAS is on the
   Hub (ids, layer 4, 2016–2020, needs the dictionary); the two suppression rules with their
   floor consequence; LIHTC sentinels (`8888`/`9999`, `LI_UNITS > N_UNITS`) and the code tables
   for `CREDIT`/`TYPE`/`NON_PROF`/`TRGT_*`; "Picture, Income Limits, FMR history are HUD User,
   not Hub"; eval cases.
2. **Next (the real unblock): fork PRs O1 and O2.** Render every returned row (CSV/JSON within
   the 60k frame, with a "shown N of M" notice), plus `offset`, `order_by`, total count and
   `exceededTransferLimit`; and a `layer` argument with layers and tables listed in
   `get_dataset`. Sync data-smart and redeploy (owner). This alone turns 47 calls into about 6
   and reaches SAFMR. O3 (statistics) and O4 (full plain-text description, dates, source/licence
   block, metadata field labels, domains when present) follow.
3. **Then: an M-milestone for a HUD User server**, spike-to-ADR first. Scope: FMR (history,
   SAFMR by ZIP), Income Limits/MTSP, CHAS, Picture of Subsidized Households, each with FY or
   vintage as envelope `vintage`, suppression as per-value caveats, and the HUD User sentence.
   It gets FMR-area keys from the catalog, which also serves the guide. Hub inventories
   (LIHTC, multifamily, public housing, vouchers, QCT/DDA) stay on the fixed connector unless
   usage shows they need enforcement.

C is rejected for now. It re-implements a portal client for ~8 Hub layers that a fixed
generic connector serves, and it doubles the drift surface, all for guarantees the guide
already states.

### Issues that would be filed (not filed)

*federal-mcps:*
- **#215** (exists): LIHTC `COUNTY_LEVEL`/`PLACE_LEVEL` unpadded, plus the CO/CA eval case.
- **skills/hud-open-data: CHAS on the Hub, suppression floors, LIHTC sentinels and code
  tables, non-Hub sources named.** AC: each fact verified with a date; three eval cases (a
  voucher sum stated as a floor, a `-4` field reported as suppressed, a PSH question answered
  "not on the Hub; HUD User").
- **ADR-015 amendment** (after the rulings): HUD split into two sources; an access limitation
  blocks guide release (§6).
- **Catalog: HUD FMR area per county as an agency-code column** (build input: HUD's FY FMR
  area definitions; *source file not verified in this spike*). AC: `geo_resolve_place` for
  Marshall County IN returns `NCNTY18099N18099`, and for St. Joseph `METRO43780M43780`.
- **Spike → ADR for a HUD User server** (this document can serve as the spike once the owner
  rules). Build issues are cut from the rulings. Sketch only: package + shell + token +
  Terraform; core per-minute limiter; FMR/SAFMR/IL indicators; CHAS; PSH; compare + raw;
  reconcile/evals/deploy. About 7–8 issues, like M8.

*OpenContext fork (`sgarcese/OpenContext`), then offered upstream:*
- **O1 `query_data` returns every row up to `limit`** in CSV/JSON inside the frame, with
  `offset`, `order_by`, total count and transfer-limit notice.
- **O2 `layer` argument; `get_dataset` lists layers and tables.**
- **O3 statistics tool** (`outStatistics`, `groupByFieldsForStatistics`, `having`), like
  `aggregate_data` in the CKAN/Philly plugins.
- **O4 metadata:** full plain-text description (HTML stripped, no 300-char cut), `editingInfo`
  dates, licence and source URL block, field domains and metadata-XML field labels in
  `get_schema`.
- (#13 geometry is not recommended now: tract maps need boundaries the dashboard already gets
  from Census cartographic files.)

### Decisions for the owner

1. **HUD Hub layers: guide + fixed connector (recommended) or server?** Recommendation: guide +
   connector, with O1–O4.
2. **HUD User API: dedicated server (recommended), an OpenContext custom plugin, or nothing?**
   A custom plugin would reach the data but would carry no envelope, geography or contract,
   and would put a shared token in the portal's config.
3. **Where the connector fixes land.** Fork only, or also PR'd to `thealphacubicle/OpenContext`
   (and CityOfBoston). Recommendation: fork first, offer upstream.
4. **Where the HUD portal is deployed.** Keep it in data-smart and sync the snapshot manually
   (ADR-016 §1, recommended for now: the nine ArcGIS portals there benefit from the same sync),
   or move it to federal-mcps' pinned `opencontext-portal` module like CDC.
5. **Server hostname**, since `hud.responsive.city` is taken: for example
   `huduser.responsive.city`.
6. **HUD User token.** Register an account and select the FMR/IL, CHAS, Picture and USPS
   datasets. Accept the terms (60/min; the attribution sentence). Deploy as
   `HUD_USER_TOKEN` (ADR-006).
7. **USPS ZIP crosswalk.** It is geography, so under "geography is resolved once, in core" it
   belongs in the catalog build, not in a HUD tool. Recommendation: catalog, later.
8. **A per-minute limiter in core** (for all servers) versus a HUD-local one. Recommendation:
   core, since the quota rule says all upstream calls go through the core client.

## Not verified

- Any live HUD User API response (no token): entity-id formats, FMR history depth, current
  CHAS year range, and the Picture API's latest year come from HUD's documentation.
- Whether 2017–2021 or later CHAS exists on huduser.gov (the Hub carries 2016–2020).
- A published request quota for `services.arcgis.com` public hosted layers.
- How many of the ring's 11 repeated LIHTC addresses are true duplicates rather than phases.
- The source file for the county-to-FMR-area catalog column.
- The effort figures, which are estimates by analogy to M8 and PR #26, not measurements.

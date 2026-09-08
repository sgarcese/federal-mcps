# Spike: the shared geography catalog

**Date:** 2026-09-08 · **Status:** analysis complete, decision questions open ·
**Feeds:** `packages/core/src/geography`, `packages/geography-build`

## Question

Is there an existing reference that lets an LLM reconcile the geographic nomenclatures
used by different federal datasets, so a place name resolves to every agency's
identifier and the model knows which level each dataset actually publishes at? If not,
what is the minimal thing we build?

## Answer in one paragraph

No. The raw materials exist and are public domain, but nothing joins them. Census
publishes authoritative entity lists per vintage (gazetteer files, the `geoinfo` API
dataset) and the containment relationship files; OMB publishes metro delineations; each
BLS program publishes its own area code table with its own encoding of the same CBSA
and FIPS codes; CDC PLACES uses plain FIPS and ZCTA; Geocorr and HUD publish weighted
crosswalks between levels that do not nest. The closest prior art is the Census
Bureau's official MCP tool `resolve-geography-fips`, which seeds Postgres from
`geoinfo` per summary level but only links places to states and knows no agency codes,
and Google Data Commons' `/v2/resolve`, whose DCIDs are Census GEOIDs under another
name. We build a small SQLite catalog that joins these sources, plus a nomenclature
guide the model can read, and every server in the family resolves through it.

## What each agency calls the same place

Denver, Colorado, as each program sees it (all verified against the source files):

| Concept | Census | BLS LAUS | BLS CES S&A | BLS OEWS | BLS CPI | QCEW | CDC PLACES | Data Commons |
|---|---|---|---|---|---|---|---|---|
| State | GEOID `08`, sumlevel 040, UCGID `0400000US08` | `ST0800000000000` | state `08`, area `00000` | `08` / `0000000` | (region S4 West) | `08000` | `08` | `geoId/08` |
| County (Denver County) | `08031`, sumlevel 050 | `CN0803100000000` | — | — | — | `08031` | `08031` | `geoId/08031` |
| City (Denver) | `0820000`, sumlevel 160 | `CT0820000000000` (≥25k pop only) | — | — | — | — | `0820000` | `geoId/0820000` |
| Metro (Denver-Aurora-Centennial CBSA 19740) | `19740`, sumlevel 310 | `MT0819740000000` | area `19740` | `0019740` | `S48B` (bespoke, title still "Denver-Aurora-Lakewood") | `C1974` (first 4 digits, `C` prefix) | — | `geoId/C19740` |
| CSA (Denver-Aurora 216) | `216`, sumlevel 330 | `CA0821600000000` | — | — | — | `CS216` | — | — |
| Tract | `08031000101`, sumlevel 140 | — | — | — | — | — | `08031000101` | `geoId/08031000101` |
| ZCTA | `80202`, sumlevel 860 | — | — | — | — | — | `80202` | `zip/80202` |

Series IDs are then built from these: LAUS `LAUMT081974000000003`, CES
`SMU08197400000000001`, OEWS `OEUM001974000000000000004`. Note that the *same CBSA* is
spelled five different ways across BLS programs alone, and CPI does not use CBSA at all.

## The hierarchy the model has to understand

Only state → county → tract → block group → block is strictly nested. Places, ZCTAs,
CBSAs, congressional districts and school districts each cross the others. That is why
"unemployment in Denver" needs a clarifying step: the city (place 0820000, LAUS `CT`),
the county (08031, LAUS `CN`, identical territory in Denver's case but not in general),
or the metro (CBSA 19740, LAUS `MT`, ten counties). Census summary levels are the right
vocabulary for this and every source above can be mapped onto them:

| Sumlevel | Entity | Who publishes here |
|---|---|---|
| 040 | State | everyone |
| 050 | County or equivalent | Census, LAUS, QCEW, PLACES, BEA, FEMA NRI, County Health Rankings |
| 060 | County subdivision (New England towns) | Census, LAUS `CS` (New England only) |
| 140 | Tract | Census ACS 5-yr, PLACES, FEMA NRI |
| 160 | Incorporated place or CDP | Census, PLACES, LAUS `CT` (≥25k, incorporated only) |
| 170 / 172 | Consolidated city and its parts | Census only |
| 310 | CBSA (metro or micro) | Census, LAUS `MT`/`MC`, CES S&A, OEWS, QCEW, BEA, HUD FMR |
| 314 | Metro division | Census, LAUS `DV`, CES S&A, OEWS |
| 330 | Combined statistical area | Census, LAUS `CA`, QCEW |
| 500 | Congressional district | Census (volatile: renumbered every 2 years) |
| 860 | ZCTA (not ZIP) | Census, PLACES, HUD via crosswalk |
| 950–970 | School districts | Census (annual boundary changes) |

## Sources to ingest

| Source | What it gives us | Format, cadence, license |
|---|---|---|
| Census Gazetteer 2025 (`2025_Gaz_{state,counties,place,cousubs,cbsa,zcta,tracts,119CDs,unsd,elsd,scsd}_national.zip`) | One row per entity: GEOID, GNIS code, name, LSAD, FUNCSTAT, land area, centroid. The entity table. | pipe-delimited, annual, public domain |
| Census `geoinfo` API dataset (`api.census.gov/data/{year}/geoinfo`) | Same entity list per vintage with `SUMLEVEL` and `GEO_ID` (UCGID); what the official Census MCP seeds from. Use for historical vintages. | JSON, per year, no key needed for small pulls |
| ANSI code files 2020 (`national_place_by_county2020.txt`, `national_county2020.txt`, `national_cousub2020.txt`) | Place → county containment (33,619 rows; places crossing counties appear once per county), CLASSFP and FUNCSTAT for incorporated-vs-CDP. | pipe-delimited, decennial, public domain |
| OMB Bulletin 23-01 delineation files (`list1_2023.xlsx`, `list2_2023.xlsx`) | County → CBSA / metro division / CSA membership with central/outlying flag; principal cities with place FIPS. Historical vintages (2013, 2018) for time-series joins. | xlsx, on OMB revision (last July 2023), public domain |
| Census 2020 relationship files (`tab20_zcta520_{county20,place20,tract20}_natl.txt`, `tab20_cd11920_{county20,place20}_natl.txt`, `tab20_{tract,place,cousub}20_*10_natl.txt`) | Weighted overlap between non-nesting levels (land and water area of the intersection); 2010 → 2020 comparability. | pipe-delimited, decennial, public domain |
| BLS LABSTAT code tables (`la.area`, `la.area_type`, `sm.area`, `oe.area`, `cu.area`) and QCEW `area_titles.csv` | Every BLS program's area codes and titles. Prefix parsing on `la.area` (`ST`, `MT`, `DV`, `MC`, `CA`, `CN`, `CT`, `CS`, `PT`, `BS`) yields the FIPS/CBSA inside each code. CPI needs a hand-curated ~23-row map to CBSA. | tab-delimited, updated with each program's redelineation, public domain |
| Geocorr 2022 (Missouri Census Data Center) | Population-weighted allocation factors between any two 2020-vintage layers (place ↔ county, cousub ↔ CBSA, tract ↔ school district). Generated interactively, vendored as CSV. | CSV, on request, free |
| HUD-USPS ZIP crosswalk | Real ZIP codes (not ZCTAs) → tract, county, CBSA with residential/business ratios. API with free token. | xlsx or API, quarterly, reuse with attribution |
| County change log (Census, NCHS) | Connecticut planning regions 09110–09190 replacing counties 09001–09015 (2022); Alaska borough splits; Shannon → Oglala Lakota SD; Bedford city VA merger. | small hand table with validity dates |
| Wikidata (P882 county FIPS, P774 place FIPS, P590 GNIS, aliases) | Nicknames and alternate names ("Mile High City", "NYC"). Enrichment only; coverage is uneven. | SPARQL export, optional |

Runtime, not build-time: the **Census Geocoder** (`geocoding.geo.census.gov`, no key)
for street address or lat/lon → all geographies, when a user supplies an address.

## Proposed catalog schema

One SQLite file, versioned by geography vintage, shipped read-only with every server.

```
entity        (geoid PK, sumlevel, name, lsad, funcstat, state_fips, gnis, lat, lon,
               aland, vintage_from, vintage_to)
alias         (geoid, alias, source)                 -- "Denver", "Denver city", "Mile High City", old CBSA titles
containment   (child_geoid, parent_geoid, share)     -- share = 1.0 when nested; area/pop-weighted otherwise
agency_code   (geoid, agency, program, code, code_vintage, note)
                                                     -- ('19740','BLS','LAUS','MT0819740000000',2023,NULL)
                                                     -- ('19740','BLS','CPI','S48B',2013,'title still Denver-Aurora-Lakewood')
publishes_at  (agency, program, sumlevel, constraint)-- ('BLS','LAUS',160,'incorporated place, pop >= 25000')
county_change (old_geoid, new_geoid, effective, kind)
```

Estimated size with places, counties, cousubs, CBSAs, ZCTAs and CDs but without tracts:
under 15 MB. With tracts (85k rows): about 30 MB. Either fits a Lambda deployment
package; tracts can also load lazily.

## The resolver

`resolvePlace(query, {kind?, state?, asOf?})`:

1. Normalize: strip "city of", "county", "metro area", state names and abbreviations
   into a `state` hint; expand known abbreviations.
2. Candidate search over `entity.name` and `alias` (FTS5, prefix and trigram), filtered
   by `state` and `kind` when given.
3. Rank: exact name match, then LSAD preference by kind hint, then population, then
   penalize CDPs and "balance" places unless asked for.
4. For each candidate return: the entity, its parents (county, CBSA, CSA, state), every
   `agency_code` row, and `available_at` derived from `publishes_at` joined with
   whether an agency code exists (so "Denver city has LAUS but not CES S&A; use the
   metro for payroll employment" is computed, not prompted).
5. Ambiguity policy: if the top two candidates differ in kind (city vs county vs metro)
   and the caller gave no kind, return `status: ambiguous` with the candidates and a
   one-line explanation of the difference, rather than guessing. This is what makes the
   step conversational without an elicitation dependency.

Fallbacks: a place below the LAUS threshold → its county (flagged); a ZIP → ZCTA via
the HUD crosswalk (flagged with the residential share); an address → Census Geocoder.

## Helping the model, not just the code

Three things the servers expose so the LLM manages nomenclature well:

1. **A `geography://guide` MCP resource** (and the same text in `describe_source`): the
   sumlevel table above, the non-nesting warning, the city/county/metro distinction,
   ZCTA vs ZIP, and the "which level does this program publish at" matrix. Short,
   stable, written for a model.
2. **Resolver output that teaches.** Each candidate carries `kind`, `parents`,
   `available_at`, and when relevant a `caveat` ("consolidated city-county; city and
   county are the same territory", "CDP: unincorporated, no local government").
3. **Consistent identifiers in every envelope.** Every result's `place` block carries
   the GEOID, UCGID and Data Commons DCID, so a model can carry a place from one
   server to another and to Data Commons without re-resolving.

## Gotchas the build must handle

- Eight U.S. places are named Denver. Always disambiguate on state and LSAD.
- Denver is both county 08031 and place 0820000 (LAUS lists both). San Francisco,
  Philadelphia and the NYC boroughs likewise. Consolidated cities (sumlevel 170) have
  "balance" places that are not the county (Louisville, Nashville, Indianapolis).
- Places cross counties (Denver City TX, NYC across five). Use `place_by_county`
  shares, never a single parent.
- CDPs have place FIPS but no government and no LAUS series.
- LAUS city series exist only for incorporated places ≥25,000 (about 1,700) plus New
  England towns (`CS` + cousub FIPS). Everything smaller falls back to county.
- NECTAs were abolished by OMB in 2023; LAUS dropped them with January 2025 data and
  rebuilt history to 1990. Older ACS vintages and Geocorr still carry them.
- Connecticut: planning regions replaced counties in 2022. PLACES, ACS 2022+, QCEW 2024+
  use the new codes; older LAUS/BEA history and many crosswalks use the old. Store both
  with validity dates and translate on request.
- ZCTA ≠ ZIP. PO-box and single-building ZIPs have no ZCTA.
- Metro division codes are distinct 5-digit codes nested in a CBSA; CSAs are 3 digits;
  QCEW truncates CBSA to four digits; OEWS zero-pads to seven; CPI is bespoke.
- The same CBSA code changes county membership and title across 2013/2018/2023
  delineations. Key `agency_code` on vintage and keep old titles as aliases.
- Congressional and school district GEOIDs change every one to two years. Mark volatile.

## Decision questions

1. **Ship tracts in the catalog** (≈30 MB total) or load lazily from the `geoinfo` API
   on first use? Recommendation: ship them; PLACES and ACS both publish at tract and a
   Lambda cold start with a 30 MB read-only SQLite is well under a second.
2. **Vintage policy.** Single current vintage with a `county_change` translation table
   (recommended, smallest thing that unblocks), or full multi-vintage entity rows from
   day one? Recommendation: current vintage plus change table now; multi-vintage when a
   time-series question actually needs it.
3. **Geocorr dependency.** Vendor a fixed Geocorr export (recommended) or derive all
   overlaps from Census relationship files only and skip Geocorr? Recommendation: vendor
   Geocorr for population-weighted shares; relationship files give only area shares.
4. **Wikidata aliases.** Include in Phase 0 or defer? Recommendation: defer; the
   gazetteer names plus a small hand alias list cover the policy use case.
5. **Data Commons DCID in every envelope.** Recommendation: yes; it is a free
   interoperability hook since DCIDs are GEOIDs.
6. **Ambiguity behavior.** Return `status: ambiguous` and stop (recommended) versus pick
   the most populous and flag it. Recommendation: stop; a wrong level in a policy memo is
   worse than one extra turn.

# Geocorr 2022 sample export

`geocorr2022_sample.csv` is a small, hand-picked slice of a **Missouri Census Data
Center (MCDC) Geocorr 2022** correlation, 2020-vintage geographies, covering the three
crosswalks named in ADR-008 §2 / issue #55: place↔county, cousub↔CBSA, ZCTA↔tract.

## ⚠️ Known gap (#141): place↔county is sample-only, so the LAUS fallback is empty nationally

This file carries **only 7 `place_county` rows** (Atlanta, NYC). Because Census publishes
**no** 2020 place↔county relationship file (`../../download.ts`), Geocorr is the *only*
source for that edge — so a build from this sample leaves the LAUS below-threshold county
fallback (ADR-009 §6) empty for every city except those two: a small city resolves its
`below_threshold` flag but finds no containing county → `unavailable`. Full root cause,
acquisition recipe, schema-transform note, and the in-repo-vs-HuggingFace hosting decision
are in **`docs/spikes/geocorr-place-county-sourcing.md`**. Fixing #141 means replacing this
sample's `place_county` rows with a full national export (see recipe below).

## How it was generated (and how to regenerate it at full scale)

The recipe below was **verified against the live broker on 2026-09-17** (the earlier
"S3 object" note was aspirational; use this).

1. Go to https://mcdc.missouri.edu/applications/geocorr2022.html. The form submits a
   `GET` to the SAS broker at `https://mcdc.missouri.edu/cgi-bin/broker` with fixed hidden
   fields `_PROGRAM=apps.geocorr2022.sas`, `_SERVICE=MCDC_long`, `_debug=0`.
2. For `place_county`: source `g1_=place`, target `g2_=county`, weighting `wtvar=pop20`
   (2020 census population), `state=US` ("Entire United States"), output `fileout=1` +
   `filefmt=csv`, `nozerob=1`. This orients `afact` as the share of each **place**'s
   population in each county (Atlanta → 0.930 Fulton / 0.070 DeKalb), matching this file.
3. **Gotcha:** a trimmed GET returns HTTP 200 but the SAS job fails
   (`%EVAL`/`%IF` numeric-operand error, unresolved `LONGITUDE`/`LATITUDE`) — the real form
   sends the *complete* field set. Either drive the form once via browser automation, or
   replay a GET with every field from `geocorr2022.html`. The broker answers with an HTML
   "Query Output" page linking the generated CSV under a scratch path (not a stable URL).
4. **Schema transform.** Raw Geocorr output columns (`state, county, place, …, pop20, afact`)
   are **not** the vendored schema below; transform raw → these columns (or teach
   `parse/geocorr.ts` the native layout). Prefer a small transform so the parser is untouched.
5. **Size.** `place_county` alone is ~40–50k rows, a few MB raw / **<1 MB gzipped** — small
   enough to vendor. The "tens of megabytes" caution applies to the full multi-crosswalk
   export; the giant `zcta_tract` pair is instead covered by a downloaded Census file, so
   only `place_county` needs sourcing here.

This sample keeps only the rows needed by the fixtures in `assemble.test.ts` and a few
well-known crossings (Atlanta/Fulton-DeKalb, NYC's five boroughs, ZCTA 19104/02134); it
unblocks development and tests without a network dependency.

## Columns

| Column | Meaning |
|---|---|
| `geo_pair` | Which crosswalk this row belongs to: `place_county`, `cousub_cbsa`, `zcta_tract`. Informational only; the parser is told which pair to read via its column choice, not this field. |
| `child_geoid` | The Census GEOID of the "target" geography in `containment.child_geoid`. |
| `child_name` | Human-readable name, for spot-checking. Not loaded into the catalog. |
| `parent_geoid` | The Census GEOID of the anchor ("source") geography in `containment.parent_geoid`. |
| `parent_name` | Human-readable name, for spot-checking. Not loaded into the catalog. |
| `afact` | Geocorr's population-weighted allocation factor: the fraction of the anchor's 2020 population that falls in the target geography's slice. Loaded directly as `containment.share`. |
| `pop20` | The 2020 population of the intersection, for reference. Not loaded. |

## Precedence

Geocorr's `afact` is **population-weighted** and is the authoritative `share` wherever
it covers an edge; the Census relationship files (`parse/relationship.ts`) are
**area-weighted** and are the fallback everywhere Geocorr has no row. `assemble.ts`
dedupes by `(child_geoid, parent_geoid)` and lets a Geocorr row win over a
relationship-file row for the same edge.

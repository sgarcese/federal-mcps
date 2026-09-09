# Geocorr 2022 sample export

`geocorr2022_sample.csv` is a small, hand-picked slice of a **Missouri Census Data
Center (MCDC) Geocorr 2022** correlation, 2020-vintage geographies, covering the three
crosswalks named in ADR-008 §2 / issue #55: place↔county, cousub↔CBSA, ZCTA↔tract.

## How it was generated (and how to regenerate it at full scale)

1. Go to https://mcdc.missouri.edu/applications/geocorr2022.html.
2. For each crosswalk, pick the two source/target geographies (e.g. "Places 2020" as
   source, "Counties" as target), tick "Population" as the weighting variable, and
   request 2020 Census population weighting (Geocorr's `afact` is the population share
   of the source geography's piece that falls in the target).
3. Submit; Geocorr runs the job and emails/serves a CSV.
4. This file keeps only the rows needed by the fixtures in `assemble.test.ts` and a few
   well-known crossing examples (Atlanta/Fulton-DeKalb, NYC's five boroughs, ZCTA
   19104/02134) — a full national Geocorr export is tens of megabytes and is **not**
   committed here. A real build regenerates the full export the same way and points
   `SOURCE_URLS`/`cli/build.ts` at the resulting file (or a versioned S3 object); this
   sample only unblocks development and tests without a network dependency.

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

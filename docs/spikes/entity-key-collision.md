# Spike: the catalog entity key collides across summary levels (#73)

## Problem
`entity.geoid` is the sole primary key, and every resolver lookup and every edge table
(`containment`, `alias`, `agency_code`, `lineage`, `name_fts`) keys on `geoid`. But a
Census GEOID is **not unique across summary levels** — county, CBSA and ZCTA GEOIDs are
all 5 digits and overlap:

| Collision | Count | Example |
|---|---|---|
| county ↔ ZCTA | 1,506 | `06075` = San Francisco County **and** ZCTA 06075 |
| CBSA ↔ ZCTA | 336 | `10580` = Albany, NY metro **and** ZCTA 10580 |

The national build fails at `INSERT INTO entity` (`UNIQUE constraint failed: entity.geoid`),
and even if it didn't, `getEntity("06075")`, `overlapsOf`, `parentsOf` etc. would be
ambiguous. This is the blocker behind #74's build once the format bugs are fixed.

## What must change
- `entity` primary key (currently `geoid`).
- Every edge table's geoid columns: `containment(child_geoid, parent_geoid)`,
  `alias(geoid)`, `agency_code(geoid)`, `lineage(from/to_geoid)` (tract-only, 11-digit,
  no collision — but should be consistent), `name_fts(geoid UNINDEXED)`.
- The resolver queries in `packages/core/src/geography/catalog.ts` (all key on `geoid`).
- The build (`assemble.ts`) emits every row with the new key.
- Tools take a `geoid` argument; they need a way to disambiguate (or accept the
  unambiguous id).

## Options
1. **Key by UCGID (recommended).** The Census Uniform Geographic Identifier —
   `<level>0000US<geoid>`, e.g. `0500000US06075` (county) vs `8600000US06075` (ZCTA) — is
   globally unique across levels, is a Census standard, and the resolver **already computes
   and returns it** (`candidate.ucgid`, parents use `${sumlevel}0000US${geoid}`). Entity PK
   becomes `ucgid`; keep `geoid` + `sumlevel` as columns; edges reference UCGIDs. Tools
   accept a UCGID for an unambiguous lookup, and resolve a bare `geoid` through
   `resolve_place` (which already returns candidates by kind) when it is ambiguous.
2. **Composite key `(sumlevel, geoid)`.** Same information, two columns everywhere. Every
   lookup signature grows a `sumlevel` argument; every edge stores two extra columns. More
   invasive at the call sites than a single-column UCGID that encodes the same pair.
3. **Namespace ZCTAs only.** Prefix just ZCTA geoids (the "odd" ZIP-like ones). Smaller
   change, but leaves an inconsistent model (some ids namespaced, some not) and doesn't
   generalize to the CBSA↔ZCTA case cleanly.

## Recommendation
**Option 1 (UCGID).** It reuses an identifier the system already treats as the canonical
cross-level, cross-agency id, keeps single-column keys, and makes the tool contract honest:
an unambiguous id resolves directly; a bare geoid goes through `resolve_place`. Amend
ADR-003 §6 (identifiers) and ADR-008 to record UCGID as the entity key.

## Decision needed
Which key model? (Recommendation: UCGID.) Ruling recorded on #73, then an ADR amendment,
then the build.

## Ruling (2026-09-09)
**UCGID (Option 1).** Entities are keyed by UCGID; `geoid` + `sumlevel` remain columns
(indexed on `geoid`). Every edge and the name index reference UCGIDs. Tools accept a UCGID
for an exact lookup and resolve a bare `geoid` through `resolve_place` when it is ambiguous.
ADR-003 §6 is amended accordingly.

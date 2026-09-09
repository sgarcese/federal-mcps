import { ucgidOf } from "@federal-mcps/core";
import { COUNTY_CHANGES, PUBLISHES_AT } from "./data/static.js";
import { parseCesArea, parseCpiArea, parseLausArea, parseOewsArea } from "./parse/bls-area.js";
import { parseGazetteer } from "./parse/gazetteer.js";
import { parseGeocorr } from "./parse/geocorr.js";
import {
  parseCdCounty,
  parseCdPlace,
  parsePlaceCounty,
  parseTractLineage,
  parseZctaCounty,
  parseZctaPlace,
  parseZctaTract,
} from "./parse/relationship.js";
import type {
  AgencyCodeRow,
  AliasRow,
  CatalogRows,
  ContainmentRow,
  EntityRow,
  LineageRow,
} from "./types.js";

/** The source files a catalog build reads, as already-decoded text. */
export interface Sources {
  /** Census National Gazetteer files, keyed by the summary level they contain. */
  gazetteers: Partial<Record<string, string>>;
  /** BLS LABSTAT area tables, when present. */
  lausArea?: string;
  cesArea?: string;
  oewsArea?: string;
  cpiArea?: string;
  /** Census 2020 relationship files (ADR-008 §2, #55). */
  zctaTract?: string;
  zctaCounty?: string;
  zctaPlace?: string;
  cdCounty?: string;
  cdPlace?: string;
  /** Place↔county weighted containment, when a source carries the tab20 shape (#55). */
  placeCounty?: string;
  /** `tab20_tract20_tract10_natl.txt`, 2010→2020 tract succession (#55). */
  tractLineage?: string;
  /** The vendored Geocorr export (#55); population-weighted, wins over relationship shares. */
  geocorr?: string;
}

/**
 * Turns source file contents into the rows a catalog build inserts. Pure and testable —
 * the CLI does the downloading, this does the parsing and the derivations.
 *
 * Containment combines three layers: STRICT geoid-nesting (county in state, tract in
 * county, place in state — share always 1.0), area-weighted overlap from the Census 2020
 * relationship files, and population-weighted overlap from the vendored Geocorr export.
 * Where both a relationship file and Geocorr cover the same `(child, parent)` edge,
 * Geocorr's population-weighted share wins (#55; see `parse/geocorr.ts`).
 */
export function assemble(sources: Sources): CatalogRows {
  const entities: EntityRow[] = [];
  const aliases: AliasRow[] = [];

  for (const [sumlevel, text] of Object.entries(sources.gazetteers)) {
    if (!text) continue;
    const parsed = parseGazetteer(text, sumlevel);
    extend(entities, parsed.entities);
    extend(aliases, parsed.aliases);
  }

  const agencyCodes: AgencyCodeRow[] = [];
  if (sources.lausArea) extend(agencyCodes, parseLausArea(sources.lausArea));
  if (sources.cesArea) extend(agencyCodes, parseCesArea(sources.cesArea));
  if (sources.oewsArea) extend(agencyCodes, parseOewsArea(sources.oewsArea));
  if (sources.cpiArea) extend(agencyCodes, parseCpiArea(sources.cpiArea));

  // Relationship-file edges are areal overlaps (ZCTA/CD layers do not nest); a place
  // spanning counties is a hierarchy allocation ("nests"). (#57 discriminator.)
  const weighted: ContainmentRow[] = [];
  if (sources.zctaTract)
    extend(weighted, withRelation(parseZctaTract(sources.zctaTract), "overlaps"));
  if (sources.zctaCounty)
    extend(weighted, withRelation(parseZctaCounty(sources.zctaCounty), "overlaps"));
  if (sources.zctaPlace)
    extend(weighted, withRelation(parseZctaPlace(sources.zctaPlace), "overlaps"));
  if (sources.cdCounty) extend(weighted, withRelation(parseCdCounty(sources.cdCounty), "overlaps"));
  if (sources.cdPlace) extend(weighted, withRelation(parseCdPlace(sources.cdPlace), "overlaps"));
  if (sources.placeCounty)
    extend(weighted, withRelation(parsePlaceCounty(sources.placeCounty), "nests"));

  const geocorr: ContainmentRow[] = [];
  if (sources.geocorr) {
    for (const pair of ["place_county", "cousub_cbsa", "zcta_tract"]) {
      const rel = pair.startsWith("zcta") ? "overlaps" : "nests";
      extend(geocorr, withRelation(parseGeocorr(sources.geocorr, pair), rel));
    }
  }

  const lineage: LineageRow[] = sources.tractLineage ? parseTractLineage(sources.tractLineage) : [];

  return {
    entities,
    aliases,
    containment: [...deriveStrictContainment(entities), ...mergeWeighted(weighted, geocorr)],
    agencyCodes,
    publishesAt: [...PUBLISHES_AT],
    countyChange: [...COUNTY_CHANGES],
    lineage,
  };
}

/**
 * Combines area-weighted (relationship-file) and population-weighted (Geocorr) containment
 * for the same `(child, parent)` edge, letting Geocorr win — it is population-weighted and
 * declared authoritative (#55, `data/geocorr/README.md`).
 */
function mergeWeighted(
  relationship: readonly ContainmentRow[],
  geocorr: readonly ContainmentRow[],
): ContainmentRow[] {
  const byKey = new Map<string, ContainmentRow>();
  for (const row of relationship) byKey.set(`${row.childUcgid} ${row.parentUcgid}`, row);
  for (const row of geocorr) byKey.set(`${row.childUcgid} ${row.parentUcgid}`, row); // Geocorr wins
  return [...byKey.values()];
}

/**
 * Strict, share=1.0 nesting from GEOIDs alone: county→state, tract→county, place→state.
 * Only emitted when the parent entity is actually present, so we never point at a missing
 * row. Non-nesting relations (place↔county, county↔CBSA) are #55's weighted containment.
 */
function withRelation(
  rows: readonly ContainmentRow[],
  relation: "nests" | "overlaps",
): ContainmentRow[] {
  return rows.map((r) => ({ ...r, relation }));
}

/**
 * Append every item of `source` to `target`. Used instead of `target.push(...source)`
 * because the national relationship files run to hundreds of thousands of rows, and a
 * spread into a function call overflows the argument-count / call-stack limit (#73).
 */
function extend<T>(target: T[], source: readonly T[]): void {
  for (const item of source) target.push(item);
}

function deriveStrictContainment(entities: EntityRow[]): ContainmentRow[] {
  const present = new Set(entities.map((e) => e.ucgid));
  const out: ContainmentRow[] = [];
  const add = (childUcgid: string, parentUcgid: string): void => {
    if (present.has(parentUcgid))
      out.push({ childUcgid, parentUcgid, share: 1, relation: "nests" });
  };
  for (const e of entities) {
    switch (e.sumlevel) {
      case "050": // county → state
        add(e.ucgid, ucgidOf("040", e.geoid.slice(0, 2)));
        break;
      case "140": // tract → county
        add(e.ucgid, ucgidOf("050", e.geoid.slice(0, 5)));
        break;
      case "160": // place → state (place↔county is weighted, #55)
        add(e.ucgid, ucgidOf("040", e.geoid.slice(0, 2)));
        break;
      default:
        break;
    }
  }
  return out;
}

import { COUNTY_CHANGES, PUBLISHES_AT } from "./data/static.js";
import { parseCesArea, parseCpiArea, parseLausArea, parseOewsArea } from "./parse/bls-area.js";
import { parseGazetteer } from "./parse/gazetteer.js";
import type { AgencyCodeRow, AliasRow, CatalogRows, ContainmentRow, EntityRow } from "./types.js";

/** The source files a catalog build reads, as already-decoded text. */
export interface Sources {
  /** Census National Gazetteer files, keyed by the summary level they contain. */
  gazetteers: Partial<Record<string, string>>;
  /** BLS LABSTAT area tables, when present. */
  lausArea?: string;
  cesArea?: string;
  oewsArea?: string;
  cpiArea?: string;
}

/**
 * Turns source file contents into the rows a catalog build inserts. Pure and testable —
 * the CLI does the downloading, this does the parsing and the derivations.
 *
 * Containment here is only the STRICT geoid-nesting we can derive (county in state, tract
 * in county, place in state). Weighted overlap (place↔county, ZCTA↔tract) and tract
 * lineage need the Census relationship files and Geocorr; they are loaded by #55.
 */
export function assemble(sources: Sources): CatalogRows {
  const entities: EntityRow[] = [];
  const aliases: AliasRow[] = [];

  for (const [sumlevel, text] of Object.entries(sources.gazetteers)) {
    if (!text) continue;
    const parsed = parseGazetteer(text, sumlevel);
    entities.push(...parsed.entities);
    aliases.push(...parsed.aliases);
  }

  const agencyCodes: AgencyCodeRow[] = [];
  if (sources.lausArea) agencyCodes.push(...parseLausArea(sources.lausArea));
  if (sources.cesArea) agencyCodes.push(...parseCesArea(sources.cesArea));
  if (sources.oewsArea) agencyCodes.push(...parseOewsArea(sources.oewsArea));
  if (sources.cpiArea) agencyCodes.push(...parseCpiArea(sources.cpiArea));

  return {
    entities,
    aliases,
    containment: deriveStrictContainment(entities),
    agencyCodes,
    publishesAt: [...PUBLISHES_AT],
    countyChange: [...COUNTY_CHANGES],
    lineage: [], // #55
  };
}

/**
 * Strict, share=1.0 nesting from GEOIDs alone: county→state, tract→county, place→state.
 * Only emitted when the parent entity is actually present, so we never point at a missing
 * row. Non-nesting relations (place↔county, county↔CBSA) are #55's weighted containment.
 */
function deriveStrictContainment(entities: EntityRow[]): ContainmentRow[] {
  const present = new Set(entities.map((e) => e.geoid));
  const out: ContainmentRow[] = [];
  const add = (child: string, parent: string): void => {
    if (present.has(parent)) out.push({ childGeoid: child, parentGeoid: parent, share: 1 });
  };
  for (const e of entities) {
    switch (e.sumlevel) {
      case "050": // county → state
        add(e.geoid, e.geoid.slice(0, 2));
        break;
      case "140": // tract → county
        add(e.geoid, e.geoid.slice(0, 5));
        break;
      case "160": // place → state (place↔county is weighted, #55)
        add(e.geoid, e.geoid.slice(0, 2));
        break;
      default:
        break;
    }
  }
  return out;
}

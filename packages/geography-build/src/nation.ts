import { ucgidOf } from "@federal-mcps/core";
import { CENSUS_DIVISIONS, NATION } from "./data/static.js";
import type { AliasRow, ContainmentRow, EntityRow } from "./types.js";

/** The 50 states and DC: every state a Census division lists (Puerto Rico is in none). */
const NATION_STATES: ReadonlySet<string> = new Set(CENSUS_DIVISIONS.flatMap((d) => d.states));

/**
 * The United States as a catalog place (#290): the 010 entity, its hand aliases, and the nesting
 * of every present state and region in it (share 1). Exported so the fixture catalogs mirror the
 * production catalog's shape (a lesson from #271) instead of retyping the nation.
 */
export function nationRows(present: readonly Pick<EntityRow, "ucgid" | "geoid" | "sumlevel">[]): {
  entities: EntityRow[];
  aliases: AliasRow[];
  containment: ContainmentRow[];
} {
  const ucgid = ucgidOf("010", NATION.geoid);
  const entity: EntityRow = {
    ucgid,
    geoid: NATION.geoid,
    sumlevel: "010",
    name: NATION.name,
    lsad: null,
    funcstat: null,
    stateFips: null,
    gnis: null,
    lat: null,
    lon: null,
    aland: null,
  };
  const aliases = NATION.aliases.map((alias) => ({ ucgid, alias, source: "hand" }));
  const containment: ContainmentRow[] = present
    .filter((e) => (e.sumlevel === "040" && NATION_STATES.has(e.geoid)) || e.sumlevel === "020")
    .map((e) => ({ childUcgid: e.ucgid, parentUcgid: ucgid, share: 1, relation: "nests" }));
  return { entities: [entity], aliases, containment };
}

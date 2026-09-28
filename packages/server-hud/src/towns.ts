import {
  type GeographyCatalog,
  getContainment,
  type IndicatorFallback,
  type PlaceCandidate,
  ucgidOf,
} from "@federal-mcps/core";
import { fmrEntityOf, isNewEngland } from "./hud-api.js";

/**
 * Where a place without its own FMR / Income Limits area gets one (#241, ADR-018 §3). HUD sets
 * those per county or metro area, except in New England, where it sets them per town:
 *
 * - a New England city answers with its town — the county subdivision that is the same
 *   municipality (the catalog's place → town edge);
 * - any other city, and a county subdivision outside New England, answers with its county's area.
 *
 * `countyCaveat` is the program's own wording for the county substitution.
 */
export function hudAreaFallback(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
  program: string,
  countyCaveat: (county: string, place: string) => string,
): IndicatorFallback | undefined {
  const sumlevel = place.kind.sumlevel;
  if (sumlevel !== "160" && sumlevel !== "060") return undefined;
  const parents = getContainment(catalog, place.ucgid).sort((a, b) => b.share - a.share);

  if (isNewEngland(place.geoid)) {
    if (sumlevel !== "160") return undefined; // a New England town is its own area
    const town = parents.find((e) => e.kind.sumlevel === "060");
    if (!town) return undefined;
    const code = fmrEntityOf({
      geoid: town.geoid,
      kind: town.kind,
      agencyCodes: catalog.agencyCodesOf(ucgidOf("060", town.geoid)),
    } as unknown as PlaceCandidate);
    if (!code) return undefined;
    return {
      geoid: town.geoid,
      name: town.name,
      sumlevel: "060",
      code,
      caveat: `HUD publishes New England ${program} by town: this is the town of ${town.name}, the same municipality as ${place.name}.`,
    };
  }

  for (const county of parents.filter((e) => e.kind.sumlevel === "050")) {
    const code = fmrEntityOf({ geoid: county.geoid, kind: county.kind } as PlaceCandidate);
    if (code) {
      return {
        geoid: county.geoid,
        name: county.name,
        sumlevel: "050",
        code,
        caveat: countyCaveat(county.name, place.name),
      };
    }
  }
  return undefined;
}

/** Why a New England county has no FMR or Income Limits area of its own (#241). */
export function newEnglandCountyNote(place: PlaceCandidate, program: string): string | undefined {
  if (place.kind.sumlevel !== "050" || !isNewEngland(place.geoid)) return undefined;
  return `HUD publishes New England ${program} by town, not by county: ask for a town in ${place.name} (kind "town").`;
}

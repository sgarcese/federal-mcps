/**
 * Places to BEA GeoFips (#253 wave seam, ADR-019 §6) — shared by every indicator family so none
 * builds codes of its own. Codes come from the catalog, never typed:
 *
 *   county (050)  its FIPS — or, for a Virginia component or Kalawao/Maui, the combination code the
 *                 catalog carries as a `bea`/`GEOFIPS` agency code (#257), with a caveat naming it;
 *   state (040)   `SS000`;
 *   metro (310)   its CBSA code (BEA's MSAs are 2023 OMB CBSAs, verified 2026-09-28).
 *
 * BEA publishes nothing for cities or towns: they fall back to their county (or, for regional price
 * parities, their metro), with a caveat. Connecticut's county-level series are its planning regions
 * from 2024 only.
 */
import {
  type GeographyCatalog,
  getContainment,
  type IndicatorFallback,
  type PlaceCandidate,
  ucgidOf,
} from "@federal-mcps/core";

/** The first year BEA publishes Connecticut's planning regions; the former counties end the year before. */
export const CONNECTICUT_PLANNING_REGIONS_FROM = 2024;

type Codes = Pick<PlaceCandidate, "agencyCodes">;

/** A county's BEA combination code and its note, when BEA publishes it only combined (#257). */
export function beaCombinationOf(place: Codes): { code: string; note: string } | undefined {
  const row = place.agencyCodes?.find((c) => c.agency === "bea" && c.program === "GEOFIPS");
  return row
    ? { code: row.code, note: row.note ?? `BEA publishes this area combined, as ${row.code}.` }
    : undefined;
}

/** A county's GeoFips: its combination code when BEA combines it, else its own FIPS. */
export function beaCountyFips(
  place: Pick<PlaceCandidate, "geoid" | "kind" | "agencyCodes">,
): string | undefined {
  if (place.kind.sumlevel !== "050") return undefined;
  return beaCombinationOf(place)?.code ?? place.geoid;
}

/** A state's GeoFips (`SS000`). */
export function beaStateFips(place: Pick<PlaceCandidate, "geoid" | "kind">): string | undefined {
  return place.kind.sumlevel === "040" ? `${place.geoid}000` : undefined;
}

/** A metro area's GeoFips: its CBSA code. */
export function beaMetroFips(place: Pick<PlaceCandidate, "geoid" | "kind">): string | undefined {
  return place.kind.sumlevel === "310" ? place.geoid : undefined;
}

/** The caveat a direct county answer carries when BEA combines it (a `caveatOf` for families). */
export function combinationCaveat(place: Codes): string | undefined {
  return beaCombinationOf(place)?.note;
}

/**
 * A city (160) or town (060) answers with its county (the containing county with the largest
 * share), because BEA publishes no city or town statistics. The county's own combination applies.
 */
export function beaCountyFallback(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
  program: string,
): IndicatorFallback | undefined {
  if (place.kind.sumlevel !== "160" && place.kind.sumlevel !== "060") return undefined;
  const county = getContainment(catalog, place.ucgid)
    .filter((e) => e.kind.sumlevel === "050")
    .sort((a, b) => b.share - a.share)[0];
  if (!county) return undefined;
  const codes = catalog.agencyCodesOf(ucgidOf("050", county.geoid));
  const combination = beaCombinationOf({ agencyCodes: codes });
  const code = combination?.code ?? county.geoid;
  const caveat = [
    `BEA publishes ${program} by county, not by city or town: this is ${county.name}'s, covering ${place.name}.`,
    combination?.note,
  ]
    .filter(Boolean)
    .join(" ");
  return { geoid: county.geoid, name: county.name, sumlevel: "050", code, caveat };
}

/**
 * A county, city or town answers with its metro area (for metro-only statistics such as regional
 * price parities): the containing CBSA, reached through the county when the place is a city or town.
 */
export function beaMetroFallback(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
  program: string,
): IndicatorFallback | undefined {
  const level = place.kind.sumlevel;
  if (level !== "050" && level !== "160" && level !== "060") return undefined;
  const direct = getContainment(catalog, place.ucgid);
  const county =
    level === "050"
      ? undefined
      : direct.filter((e) => e.kind.sumlevel === "050").sort((a, b) => b.share - a.share)[0];
  const edges = county ? getContainment(catalog, ucgidOf("050", county.geoid)) : direct;
  const metro = edges.filter((e) => e.kind.sumlevel === "310").sort((a, b) => b.share - a.share)[0];
  if (!metro) return undefined;
  return {
    geoid: metro.geoid,
    name: metro.name,
    sumlevel: "310",
    code: metro.geoid,
    caveat: `BEA publishes ${program} by metropolitan area: this is ${metro.name}'s, which includes ${place.name}.`,
  };
}

/** True for a Connecticut county-level GeoFips (the planning regions, 09110–09190). */
export function isConnecticutRegion(geoFips: string): boolean {
  return /^091[1-9]0$/.test(geoFips);
}

/**
 * The note a Connecticut planning-region answer carries when years before 2024 were asked for:
 * BEA publishes the regions from 2024 only, and does not stitch the former counties onto them.
 */
export function connecticutNote(
  geoFips: string,
  startYear: number | undefined,
): string | undefined {
  if (!isConnecticutRegion(geoFips) || startYear === undefined) return undefined;
  if (startYear >= CONNECTICUT_PLANNING_REGIONS_FROM) return undefined;
  return `BEA publishes Connecticut's planning regions from ${CONNECTICUT_PLANNING_REGIONS_FROM}; its eight former counties end in ${CONNECTICUT_PLANNING_REGIONS_FROM - 1} and cover different areas, so years before ${CONNECTICUT_PLANNING_REGIONS_FROM} are not shown for this region.`;
}

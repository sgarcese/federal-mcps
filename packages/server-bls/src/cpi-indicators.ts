import type { GeographyCatalog, PlaceCandidate } from "@federal-mcps/core";
import { buildCuSeriesId, CPI_US_CITY_AVERAGE_AREA } from "./cpi.js";
import type { IndicatorDefinition, IndicatorFallback } from "./registry.js";

/**
 * CPI registered as an indicator definition (ADR-010 §1, §4). CPI publishes only for the U.S. city
 * average, census regions/divisions, and ~23 named metros — the catalog carries the metro CPI area
 * codes on those CBSAs. A place that is one of those metros gets its real series; every other place
 * falls back to the U.S. city average with an explicit "CPI is not published for <place>" caveat —
 * never a fabricated local index (ADR-010 §4). (Census region/division fallbacks are a refinement.)
 */
const CPI_PROGRAM = "CPI";

/** The CPI area code on a resolved place, if it is one of the ~23 published metros. */
export function cpiAreaOf(place: PlaceCandidate): string | undefined {
  return place.agencyCodes.find((c) => c.agency === "bls" && c.program === CPI_PROGRAM)?.code;
}

/**
 * CPI's "no local CPI" fallback: any place without its own published CPI area resolves to the U.S.
 * city average, carrying the caveat that the number is national, not local. Always returns (CPI can
 * always answer with the U.S. city average), so `get_indicator` never reports CPI as unavailable.
 */
function cpiFallback(_catalog: GeographyCatalog, place: PlaceCandidate): IndicatorFallback {
  return {
    geoid: CPI_US_CITY_AVERAGE_AREA,
    name: "U.S. city average",
    sumlevel: "010",
    code: CPI_US_CITY_AVERAGE_AREA,
    caveat: `CPI is not published for ${place.name}; showing the U.S. city average (CPI-U, all items). Local CPI is available only for about 23 large metro areas.`,
  };
}

/** CPI all items (CPI-U), NSA by default (ADR-010 §5). */
export const cpiIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "cpi_all_items",
    program: CPI_PROGRAM,
    description: "Consumer Price Index for All Urban Consumers (CPI-U), all items.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: cpiAreaOf,
    buildSeriesId: (code, { seasonallyAdjusted }) => buildCuSeriesId(code, { seasonallyAdjusted }),
    fallback: cpiFallback,
  },
];

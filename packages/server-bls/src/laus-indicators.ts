import {
  type GeographyCatalog,
  getContainment,
  type PlaceCandidate,
  ucgidOf,
} from "@federal-mcps/core";
import { buildLausSeriesId, LAUS_MEASURE_DESCRIPTIONS, LAUS_MEASURES } from "./laus.js";
import type { IndicatorDefinition, IndicatorFallback, PlaceAgencyCodes } from "./registry.js";

/**
 * LAUS registered as indicator definitions (ADR-010 §1). The four measures each become an
 * indicator over the `LAUS` program, sharing the series-id builder (ADR-009 §3), the LAUS
 * agency-code lookup, and the below-threshold county fallback (ADR-009 §6).
 */
const LAUS_PROGRAM = "LAUS";

/** The LAUS `agency_code` (the 15-char la.area code) for a resolved place, if it has one. */
export function lausCodeOf(place: PlaceAgencyCodes): string | undefined {
  return place.agencyCodes.find((c) => c.agency === "bls" && c.program === LAUS_PROGRAM)?.code;
}

/** The county that contains `place`, with its LAUS code — the raw lookup, no eligibility gate. */
export function lausCountyLookup(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
): { geoid: string; name: string; code: string } | undefined {
  const counties = getContainment(catalog, place.ucgid)
    .filter((e) => e.kind.sumlevel === "050")
    .sort((a, b) => b.share - a.share);
  for (const county of counties) {
    const code = catalog
      .agencyCodesOf(ucgidOf("050", county.geoid))
      .find((c) => c.agency === "bls" && c.program === LAUS_PROGRAM)?.code;
    if (code) return { geoid: county.geoid, name: county.name, code };
  }
  return undefined;
}

/**
 * The LAUS below-coverage fallback: a city under the 25,000 threshold (`below_threshold`) resolves
 * to its surrounding county's series, with the caveat that must travel in the envelope. Returns
 * undefined for places that are not eligible — never a silent substitution (ADR-009 §6).
 */
function lausFallback(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
): IndicatorFallback | undefined {
  if (!place.flags.includes("below_threshold")) return undefined;
  // The place→county containment edge comes from the vendored national Geocorr crosswalk
  // (geography-build/src/data/geocorr, #141); Census ships no place↔county relationship file.
  const county = lausCountyLookup(catalog, place);
  if (!county) return undefined;
  return {
    geoid: county.geoid,
    name: county.name,
    sumlevel: "050",
    code: county.code,
    caveat: `Covers ${county.name}, not just ${place.name}: ${place.name} is below the LAUS 25,000 city threshold, so no city-level series exists.`,
  };
}

/** The four LAUS indicators as registry definitions. */
export const lausIndicatorDefinitions: IndicatorDefinition[] = LAUS_MEASURES.map((measure) => ({
  name: measure,
  program: LAUS_PROGRAM,
  description: LAUS_MEASURE_DESCRIPTIONS[measure],
  defaultSeasonallyAdjusted: false,
  agencyCodeOf: lausCodeOf,
  buildSeriesId: (code, { seasonallyAdjusted }) =>
    buildLausSeriesId(code, measure, { seasonallyAdjusted }),
  fallback: lausFallback,
}));

import type { PlaceCandidate } from "@federal-mcps/core";
import { buildOeSeriesId } from "./oe.js";
import type { IndicatorDefinition } from "./registry.js";

/**
 * OEWS (OE) registered as an indicator definition (ADR-010 §1–§2). M4 ships the statewide
 * headline — mean annual wage across all industries and occupations — so a state resolves to its
 * own FIPS geoid; metros are a follow-up (the OE metro area code is CBSA-keyed, a different shape
 * than the state area code this indicator uses).
 */
const OEWS_PROGRAM = "OEWS";
const STATE_SUMLEVEL = "040";

/** The OEWS "agency code" for a place: a state's FIPS geoid; undefined otherwise (no fabrication). */
export function oewsStateCode(place: PlaceCandidate): string | undefined {
  return place.kind.sumlevel === STATE_SUMLEVEL ? place.geoid : undefined;
}

/** OEWS occupational mean annual wage (all industries, all occupations), NSA by default (ADR-010 §5). */
export const oewsIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "occupational_wage",
    program: OEWS_PROGRAM,
    description:
      "Mean annual wage across all occupations and industries (Occupational Employment and Wage Statistics).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: oewsStateCode,
    buildSeriesId: (code, { seasonallyAdjusted }) => buildOeSeriesId(code, { seasonallyAdjusted }),
  },
];

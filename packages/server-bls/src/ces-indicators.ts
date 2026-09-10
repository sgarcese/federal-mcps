import type { PlaceCandidate } from "@federal-mcps/core";
import { buildSmSeriesId } from "./ces.js";
import type { IndicatorDefinition } from "./registry.js";

/**
 * CES State & Area (SM) registered as an indicator definition (ADR-010 §1–§2). M4 ships the
 * statewide headline — total nonfarm payroll employment — so a state resolves to its own FIPS
 * geoid; metros are a follow-up (CBSAs carry no state in the catalog, which the SM series needs).
 */
const SM_PROGRAM = "SM";
const STATE_SUMLEVEL = "040";

/** The CES "agency code" for a place: a state's FIPS geoid; undefined otherwise (no fabrication). */
export function cesStateCode(place: PlaceCandidate): string | undefined {
  return place.kind.sumlevel === STATE_SUMLEVEL ? place.geoid : undefined;
}

/** CES payroll employment (total nonfarm), NSA by default (ADR-010 §5). */
export const cesIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "payroll_employment",
    program: SM_PROGRAM,
    description: "Total nonfarm payroll employment (all employees, in thousands).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: cesStateCode,
    buildSeriesId: (code, { seasonallyAdjusted }) => buildSmSeriesId(code, { seasonallyAdjusted }),
  },
];

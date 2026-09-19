import type { PlaceCandidate } from "@federal-mcps/core";
import { buildSmSeriesId, CES_STATEWIDE_AREA } from "./ces.js";
import type { IndicatorDefinition } from "@federal-mcps/core";

/**
 * CES State & Area (SM) registered as an indicator definition (ADR-010 §1–§2). Total nonfarm
 * payroll employment, at the state level or a single-state metro. The "agency code" is the 7-char
 * `state+area` key the SM series is built from: a state resolves to its own FIPS + `00000`; a metro
 * (CBSA) uses the state+area key the catalog stores on it (#110). Other place kinds are unavailable
 * (no fabrication).
 */
const SM_PROGRAM = "SM";
const STATE_SUMLEVEL = "040";
const CBSA_SUMLEVEL = "310";

/** The CES 7-char state+area key for a place: statewide for a state, the catalog key for a metro. */
export function cesCodeOf(place: PlaceCandidate): string | undefined {
  if (place.kind.sumlevel === STATE_SUMLEVEL) return `${place.geoid}${CES_STATEWIDE_AREA}`;
  if (place.kind.sumlevel === CBSA_SUMLEVEL) {
    return place.agencyCodes.find((c) => c.agency === "bls" && c.program === SM_PROGRAM)?.code;
  }
  return undefined;
}

/** CES payroll employment (total nonfarm), NSA by default (ADR-010 §5). */
export const cesIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "payroll_employment",
    program: SM_PROGRAM,
    description: "Total nonfarm payroll employment (all employees, in thousands).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: cesCodeOf,
    // A multi-state metro is filed under its first state; the catalog records that as the SM
    // code's note, and it travels as a limitation (#153, ADR-013 §4).
    caveatOf: (place) =>
      place.agencyCodes.find((c) => c.agency === "bls" && c.program === SM_PROGRAM)?.note,
    buildSeriesId: (code, { seasonallyAdjusted }) => buildSmSeriesId(code, { seasonallyAdjusted }),
  },
];

import type { PlaceCandidate } from "@federal-mcps/core";
import {
  buildCesNationalSeriesId,
  buildSmSeriesId,
  CES_STATEWIDE_AREA,
  isCesNationalSeriesId,
} from "./ces.js";
import { BLS_TIMESERIES_ENDPOINT } from "./describe-source.js";
import { isNation, NATION_CODE } from "./nation.js";
import type { IndicatorDefinition } from "@federal-mcps/core";

/**
 * CES State & Area (SM) registered as an indicator definition (ADR-010 §1–§2). Total nonfarm
 * payroll employment, at the state level or a single-state metro. The "agency code" is the 7-char
 * `state+area` key the SM series is built from: a state resolves to its own FIPS + `00000`; a metro
 * (CBSA) uses the state+area key the catalog stores on it (#110). The nation (#290) reads the
 * national CES series (CE), labelled as such. Other place kinds are unavailable (no fabrication).
 */
const SM_PROGRAM = "SM";
const STATE_SUMLEVEL = "040";
const CBSA_SUMLEVEL = "310";

/** The nation's caveat (#290): the national CES estimate stands on its own. */
export const CES_NATIONAL_CAVEAT =
  "National figure from the CES national survey estimate (CE series), not State and Area (SM): national and state CES are estimated and benchmarked separately, so the national figure is not the sum of the states.";

/**
 * The CES code for a place: statewide key for a state, the catalog key for a metro, the nation's
 * marker for the United States (#290).
 */
export function cesCodeOf(place: PlaceCandidate): string | undefined {
  if (isNation(place)) return NATION_CODE;
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
    // code's note, and it travels as a limitation (#153, ADR-013 §4). The nation says it is CES
    // national, not State and Area (#290).
    caveatOf: (place) =>
      isNation(place)
        ? CES_NATIONAL_CAVEAT
        : place.agencyCodes.find((c) => c.agency === "bls" && c.program === SM_PROGRAM)?.note,
    buildSeriesId: (code, { seasonallyAdjusted }) =>
      code === NATION_CODE
        ? buildCesNationalSeriesId({ seasonallyAdjusted })
        : buildSmSeriesId(code, { seasonallyAdjusted }),
    // A national answer names its program: CES (national), not SM (#290).
    sourceOf: (seriesKey) =>
      isCesNationalSeriesId(seriesKey)
        ? { url: BLS_TIMESERIES_ENDPOINT, label: `${seriesKey} (CES national)`, program: "CES" }
        : undefined,
  },
];

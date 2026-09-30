import type { PlaceCandidate } from "@federal-mcps/core";
import { buildJtSeriesId, JT_DATA_ELEMENTS } from "./jt.js";
import { isNation } from "./nation.js";
import type { IndicatorDefinition } from "@federal-mcps/core";

/**
 * JOLTS (Job Openings and Labor Turnover Survey) registered as indicator definitions (ADR-010
 * §1–§2). JOLTS publishes the nation and, below it, states only — no metro JOLTS — so a state
 * resolves to its own FIPS geoid, the nation to JOLTS's national state code `00` (#290), and every
 * other place kind is unavailable (no fallback: JOLTS has no below-state substitute the way LAUS
 * falls back to a county).
 */
const JOLTS_PROGRAM = "JOLTS";
const STATE_SUMLEVEL = "040";

/** JOLTS's state code for the nation (`JTU000000000000000JOL`, recorded 2026-09-30, #290). */
const JT_NATIONAL_STATE = "00";

/**
 * The JOLTS "agency code" for a place: a state's FIPS geoid, `00` for the nation (#290); undefined
 * otherwise (no fabrication).
 */
export function joltsStateCode(place: PlaceCandidate): string | undefined {
  if (isNation(place)) return JT_NATIONAL_STATE;
  return place.kind.sumlevel === STATE_SUMLEVEL ? place.geoid : undefined;
}

/** JOLTS headline counts (total nonfarm, statewide, all size classes, level), NSA by default. */
export const joltsIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "job_openings",
    program: JOLTS_PROGRAM,
    description: "Job openings, total nonfarm (level, in thousands).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: joltsStateCode,
    buildSeriesId: (code, { seasonallyAdjusted }) =>
      buildJtSeriesId(code, JT_DATA_ELEMENTS.jobOpenings, { seasonallyAdjusted }),
  },
  {
    name: "hires",
    program: JOLTS_PROGRAM,
    description: "Hires, total nonfarm (level, in thousands).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: joltsStateCode,
    buildSeriesId: (code, { seasonallyAdjusted }) =>
      buildJtSeriesId(code, JT_DATA_ELEMENTS.hires, { seasonallyAdjusted }),
  },
  {
    name: "quits",
    program: JOLTS_PROGRAM,
    description: "Quits, total nonfarm (level, in thousands).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: joltsStateCode,
    buildSeriesId: (code, { seasonallyAdjusted }) =>
      buildJtSeriesId(code, JT_DATA_ELEMENTS.quits, { seasonallyAdjusted }),
  },
  {
    name: "layoffs",
    program: JOLTS_PROGRAM,
    description: "Layoffs and discharges, total nonfarm (level, in thousands).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: joltsStateCode,
    buildSeriesId: (code, { seasonallyAdjusted }) =>
      buildJtSeriesId(code, JT_DATA_ELEMENTS.layoffs, { seasonallyAdjusted }),
  },
];

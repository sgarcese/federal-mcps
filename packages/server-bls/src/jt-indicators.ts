import type { PlaceCandidate } from "@federal-mcps/core";
import { buildJtSeriesId, JT_DATA_ELEMENTS } from "./jt.js";
import type { IndicatorDefinition } from "./registry.js";

/**
 * JOLTS (Job Openings and Labor Turnover Survey) registered as indicator definitions (ADR-010
 * §1–§2). Below national, JOLTS publishes at the state level only — no metro JOLTS — so a state
 * resolves to its own FIPS geoid and every other place kind is unavailable (no fallback: JOLTS has
 * no below-state substitute the way LAUS falls back to a county).
 */
const JOLTS_PROGRAM = "JOLTS";
const STATE_SUMLEVEL = "040";

/** The JOLTS "agency code" for a place: a state's FIPS geoid; undefined otherwise (no fabrication). */
export function joltsStateCode(place: PlaceCandidate): string | undefined {
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

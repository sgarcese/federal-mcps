/**
 * CPS (Current Population Survey, "LN") national labor-force series identifiers, built — never
 * typed (CLAUDE.md). LAUS publishes no national figure; its state and local estimates are
 * controlled to CPS, the national household survey, so the nation's unemployment rate,
 * unemployment, employment and labor force come from CPS (#290). A headline CPS id is 11
 * characters:
 *
 *   LN · seasonal(1) · series(8)
 *
 * The 8-digit series code starts with "1" when seasonally adjusted and "0" when not, then the
 * measure digit and six zeros: unemployment rate 4, unemployed 3, employed 2, civilian labor force
 * 1 — `LNU04000000` / `LNS14000000`. Every id recorded live 2026-09-30 (fixtures/bls): Dec 2025
 * LNU04000000 = 4.1, LNS14000000 = 4.4, LNU03000000 = 7,003, LNU02000000 = 163,720,
 * LNU01000000 = 170,723 (thousands).
 */

import type { LausMeasure } from "./laus.js";

/** The CPS measure digit for each LAUS measure name (the same four measures, #290). */
const CPS_MEASURE_DIGIT: Readonly<Record<LausMeasure, string>> = Object.freeze({
  unemployment_rate: "4",
  unemployment: "3",
  employment: "2",
  labor_force: "1",
});

export interface CpsSeriesOptions {
  /** Seasonally adjusted (`LNS1…`) vs not (`LNU0…`, the default, matching LAUS's default). */
  seasonallyAdjusted?: boolean;
}

/** Build the national CPS headline id for a LAUS measure name. */
export function buildCpsSeriesId(measure: LausMeasure, options: CpsSeriesOptions = {}): string {
  const digit = CPS_MEASURE_DIGIT[measure];
  if (!digit) throw new Error(`unknown CPS measure "${measure}".`);
  return options.seasonallyAdjusted ? `LNS1${digit}000000` : `LNU0${digit}000000`;
}

/** True for a well-formed CPS headline id (`LN` + S/U + 8 digits). */
export function isCpsSeriesId(id: string): boolean {
  return /^LN[SU]\d{8}$/.test(id);
}

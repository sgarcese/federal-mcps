/**
 * CES State & Area (SM) series identifiers, built — never typed (CLAUDE.md). An SM series id is
 * exactly 20 characters:
 *
 *   SM · seasonal(1) · state_fips(2) · area(5) · industry(8) · data_type(2)
 *
 * M4 exposes the total-nonfarm headline (industry `00000000`, all employees in thousands `01`).
 * The 7-character `state+area` key is the SM series' geography: a state's own FIPS + `00000`
 * (statewide), or a metro's state + CBSA code. E.g. Colorado NSA `SMU08000000000000001`
 * (state+area `0800000`); Denver metro `SMU08197400000000001` (`0819740`). The catalog carries the
 * 7-char key as the SM agency code (state resolved at build time from the sm.area title, #110).
 * Verified against the live BLS API (Colorado 2989.6k, Denver metro 1650.0k all-employees, 2024).
 */

const SM_TOTAL_NONFARM = "00000000"; // supersector + industry: total nonfarm
const SM_ALL_EMPLOYEES = "01"; // data type: all employees, in thousands

/** The statewide CES "area" code (paired with a state FIPS to form the 7-char key). */
export const CES_STATEWIDE_AREA = "00000";

export interface SmSeriesOptions {
  /** Seasonally adjusted (`S`) vs not (`U`, the default). */
  seasonallyAdjusted?: boolean;
}

/**
 * Build a CES State & Area headline series id (total nonfarm, all employees) from a 7-character
 * `state+area` key (2-digit state FIPS + 5-digit area; `00000` area = statewide). Throws on a
 * malformed key — the id is built from validated parts.
 */
export function buildSmSeriesId(stateAndArea: string, options: SmSeriesOptions = {}): string {
  if (!/^\d{7}$/.test(stateAndArea)) {
    throw new Error(
      `CES state+area key must be 7 digits (state FIPS + 5-digit area, e.g. "0800000" statewide or "0819740" Denver); got "${stateAndArea}".`,
    );
  }
  const seasonal = options.seasonallyAdjusted ? "S" : "U";
  return `SM${seasonal}${stateAndArea}${SM_TOTAL_NONFARM}${SM_ALL_EMPLOYEES}`;
}

/**
 * Build the NATIONAL CES headline id (#290): total nonfarm, all employees, in thousands —
 * `CE` · seasonal · supersector+industry `00000000` · data type `01`. National CES is its own
 * survey estimate (the CE series), not the sum of the State & Area (SM) series. Recorded live
 * 2026-09-30 (fixtures/bls): CEU0000000001 Dec 2025 = 159,358 thousand.
 */
export function buildCesNationalSeriesId(options: SmSeriesOptions = {}): string {
  const seasonal = options.seasonallyAdjusted ? "S" : "U";
  return `CE${seasonal}${SM_TOTAL_NONFARM}${SM_ALL_EMPLOYEES}`;
}

/** True for a well-formed national CES id (`CE` + S/U + 10 digits). */
export function isCesNationalSeriesId(id: string): boolean {
  return /^CE[SU]\d{10}$/.test(id);
}

/** True for a well-formed 20-char SM series id (`SM` + S/U + 17 digits). */
export function isSmSeriesId(id: string): boolean {
  return /^SM[SU]\d{17}$/.test(id);
}

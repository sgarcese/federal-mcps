/**
 * CPI (Consumer Price Index, program "CPI", series prefix "CU") series identifiers, built — never
 * typed (CLAUDE.md). A CPI-U series id here is:
 *
 *   CU · seasonal(1) · periodicity(1) · area(4) · item(3)
 *
 * M4 exposes the all-items headline (item `SA0`), monthly periodicity (`R`), not seasonally
 * adjusted (`U`). The 4-char area is the BLS CPI area code the catalog stores as the CPI
 * `agency_code` on the ~23 published metros (e.g. Denver `S48B`), or `0000` for the U.S. city
 * average. E.g. U.S. city average all items NSA monthly: `CUUR0000SA0`; Denver: `CUURS48BSA0`.
 * Verified against the live BLS API (U.S. city average 315.6, Denver-area S48B 348.0, 2024).
 */

const CPI_ALL_ITEMS = "SA0"; // item code: all items
const CPI_MONTHLY = "R"; // periodicity: monthly (vs. S semiannual)

/** The BLS CPI area code for the U.S. city average (the universal published fallback). */
export const CPI_US_CITY_AVERAGE_AREA = "0000";

export interface CuSeriesOptions {
  /** Seasonally adjusted (`S`) vs not (`U`, the default). */
  seasonallyAdjusted?: boolean;
}

/**
 * Build a CPI-U all-items series id from a 4-char CPI area code. Throws on a malformed area code —
 * the id is built from validated parts.
 */
export function buildCuSeriesId(area: string, options: CuSeriesOptions = {}): string {
  if (!/^[0-9A-Z]{4}$/.test(area)) {
    throw new Error(`CPI area code must be 4 characters (e.g. "0000" or "S48B"); got "${area}".`);
  }
  const seasonal = options.seasonallyAdjusted ? "S" : "U";
  return `CU${seasonal}${CPI_MONTHLY}${area}${CPI_ALL_ITEMS}`;
}

/** True for a well-formed CPI-U all-items series id (`CU` + S/U + R/S + 4 + `SA0`). */
export function isCuSeriesId(id: string): boolean {
  return /^CU[SU][RS][0-9A-Z]{4}SA0$/.test(id);
}

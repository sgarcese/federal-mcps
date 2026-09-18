/**
 * CPI (Consumer Price Index, program "CPI", series prefix "CU") series identifiers, built — never
 * typed (CLAUDE.md). A CPI-U series id here is:
 *
 *   CU · seasonal(1) · periodicity(1) · area(4) · item(3+)
 *
 * The default item is the all-items headline (`SA0`), monthly periodicity (`R`), not seasonally
 * adjusted (`U`). The 4-char area is the BLS CPI area code the catalog stores as the CPI
 * `agency_code` on the ~23 published metros (e.g. Denver `S48B`), or `0000` for the U.S. city
 * average. E.g. U.S. city average all items NSA monthly: `CUUR0000SA0`; Denver: `CUURS48BSA0`.
 * Verified against the live BLS API (U.S. city average 315.6, Denver-area S48B 348.0, 2024).
 *
 * Item vocabulary (ADR-013 §1–2, #150): ~10 curated CPI expenditure groups, each verified live
 * against `https://api.bls.gov/publicAPI/v2/timeseries/data/<id>` on 2026-09-17 (REQUEST_SUCCEEDED
 * with data, no API key):
 *   - CUUR0000SA0    all items (default)
 *   - CUUR0000SAF1   food
 *   - CUUR0000SAF11  food at home
 *   - CUUR0000SAH    housing
 *   - CUUR0000SAH1   shelter
 *   - CUUR0000SA0E   energy
 *   - CUUR0000SETB01 gasoline, all types
 *   - CUUR0000SAM    medical care
 *   - CUUR0000SAT    transportation
 *   - CUUR0000SAA    apparel
 * Also checked at the Denver metro area code (CPI area `S48B`): CUURS48BSA0, CUURS48BSAF1,
 * CUURS48BSAH, and CUURS48BSAM all REQUEST_SUCCEEDED with data on 2026-09-17.
 */

/** Item code: all items — the default when no item is chosen. */
export const CPI_ALL_ITEMS = "SA0";
const CPI_MONTHLY = "R"; // periodicity: monthly (vs. S semiannual)

/** The BLS CPI area code for the U.S. city average (the universal published fallback). */
export const CPI_US_CITY_AVERAGE_AREA = "0000";

export interface CuSeriesOptions {
  /** Seasonally adjusted (`S`) vs not (`U`, the default). */
  seasonallyAdjusted?: boolean;
  /** CPI expenditure-item code (default: all items, `SA0`). */
  item?: string;
}

/**
 * Build a CPI-U series id from a 4-char CPI area code and an optional expenditure item. Throws on
 * a malformed area code — the id is built from validated parts.
 */
export function buildCuSeriesId(area: string, options: CuSeriesOptions = {}): string {
  if (!/^[0-9A-Z]{4}$/.test(area)) {
    throw new Error(`CPI area code must be 4 characters (e.g. "0000" or "S48B"); got "${area}".`);
  }
  const seasonal = options.seasonallyAdjusted ? "S" : "U";
  const item = options.item ?? CPI_ALL_ITEMS;
  return `CU${seasonal}${CPI_MONTHLY}${area}${item}`;
}

/** True for a well-formed CPI-U series id (`CU` + S/U + R/S + 4-char area + a 3+ char item code). */
export function isCuSeriesId(id: string): boolean {
  return /^CU[SU][RS][0-9A-Z]{4}[0-9A-Z]{3,}$/.test(id);
}

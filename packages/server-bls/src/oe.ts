/**
 * OEWS (Occupational Employment and Wage Statistics, "OE" survey) series identifiers, built —
 * never typed (CLAUDE.md). An OE series id is exactly 25 characters:
 *
 *   OE · seasonal(1) · areatype(1) · area(7) · industry(6) · occupation(6) · datatype(2)
 *
 * OEWS is an annual, unadjusted-only survey (seasonal is always `U`). M4 exposes the
 * state-level headline series: a state's mean annual wage across all industries and all
 * occupations (areatype `S`, area = state FIPS + "00000", industry `000000` = cross-industry,
 * occupation `000000` = all occupations, data type `04` = annual mean wage). Metro areas (area
 * type `M`, CBSA-keyed) are a follow-up. Verified against the live BLS API: Colorado (state FIPS
 * "08"), all-occupations annual mean wage, 2025 = $77,190 (`OEUS080000000000000000004`).
 */

const OE_AREA_TYPE_STATE = "S";
const OE_CROSS_INDUSTRY = "000000"; // industry: cross-industry (all industries)
const OE_ALL_OCCUPATIONS = "000000"; // occupation: all occupations (SOC 00-0000)
const OE_ANNUAL_MEAN_WAGE = "04"; // data type: annual mean wage

export interface OeSeriesOptions {
  /**
   * OEWS is annual and unadjusted only — this option is accepted for symmetry with other
   * programs' `buildSeriesId` signature but has no effect; the series id is always `U`.
   */
  seasonallyAdjusted?: boolean;
}

/**
 * Build a statewide OEWS headline series id (all industries, all occupations, annual mean wage)
 * from a 2-digit state FIPS. Throws on a malformed state code — the id is built from validated
 * parts.
 */
export function buildOeSeriesId(stateFips: string, _options: OeSeriesOptions = {}): string {
  if (!/^\d{2}$/.test(stateFips)) {
    throw new Error(
      `OEWS state FIPS must be 2 digits (e.g. "08" for Colorado); got "${stateFips}".`,
    );
  }
  const area = `${stateFips}00000`; // state FIPS + 5 zeros = 7-char area code
  return `OEU${OE_AREA_TYPE_STATE}${area}${OE_CROSS_INDUSTRY}${OE_ALL_OCCUPATIONS}${OE_ANNUAL_MEAN_WAGE}`;
}

/** True for a well-formed 25-char OE series id (`OE` + `U` + area type + 21 digits). */
export function isOeSeriesId(id: string): boolean {
  return /^OEU[MSN]\d{21}$/.test(id);
}

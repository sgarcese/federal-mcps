/**
 * CES State & Area (SM) series identifiers, built — never typed (CLAUDE.md). An SM series id is
 * exactly 20 characters:
 *
 *   SM · seasonal(1) · state_fips(2) · area(5) · industry(8) · data_type(2)
 *
 * M4 exposes the statewide headline series: total nonfarm (industry `00000000`), all employees in
 * thousands (data type `01`), area `00000` (statewide). The state FIPS is the state's own geoid,
 * e.g. Colorado not seasonally adjusted: `SMU08000000000000001`. (Metro areas — the CBSA code with
 * the metro's state — are a follow-up: CBSAs carry no state in the catalog and the SM series needs
 * one.) Verified against the live BLS API (Colorado 2989.6k all-employees, Dec 2024).
 */

const SM_TOTAL_NONFARM = "00000000"; // supersector + industry: total nonfarm
const SM_ALL_EMPLOYEES = "01"; // data type: all employees, in thousands
const SM_STATEWIDE_AREA = "00000";

export interface SmSeriesOptions {
  /** Seasonally adjusted (`S`) vs not (`U`, the default). */
  seasonallyAdjusted?: boolean;
}

/**
 * Build a statewide CES State & Area headline series id (total nonfarm, all employees) from a
 * 2-digit state FIPS. Throws on a malformed state code — the id is built from validated parts.
 */
export function buildSmSeriesId(stateFips: string, options: SmSeriesOptions = {}): string {
  if (!/^\d{2}$/.test(stateFips)) {
    throw new Error(
      `CES state FIPS must be 2 digits (e.g. "08" for Colorado); got "${stateFips}".`,
    );
  }
  const seasonal = options.seasonallyAdjusted ? "S" : "U";
  return `SM${seasonal}${stateFips}${SM_STATEWIDE_AREA}${SM_TOTAL_NONFARM}${SM_ALL_EMPLOYEES}`;
}

/** True for a well-formed 20-char SM series id (`SM` + S/U + 2 + 5 + 8 + 2). */
export function isSmSeriesId(id: string): boolean {
  return /^SM[SU]\d{17}$/.test(id);
}

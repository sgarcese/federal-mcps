/**
 * LAUS (Local Area Unemployment Statistics) series identifiers, built — never typed
 * (CLAUDE.md). A LAUS series id is exactly 20 characters:
 *
 *   LA · seasonal(1) · area_code(15) · measure_code(2)
 *
 * e.g. Denver County unemployment rate, not seasonally adjusted: `LAUCN080310000000003`
 * (LA · U · CN0803100000000 · 03). The 15-char `area_code` is the BLS `la.area` code the
 * geography catalog stores as the LAUS `agency_code` (ADR-009 §3); the measure and seasonal
 * flag come from the caller. Verified against the live `la.series`/`la.measure` files.
 */

/** The measures M3 exposes, mapped to LAUS `la.measure` codes (ADR-009 §3). */
export const LAUS_MEASURE_CODES = {
  unemployment_rate: "03",
  unemployment: "04",
  employment: "05",
  labor_force: "06",
} as const;

export type LausMeasure = keyof typeof LAUS_MEASURE_CODES;

/** The measure vocabulary, for tool enums and `list_indicators`. */
export const LAUS_MEASURES = Object.keys(LAUS_MEASURE_CODES) as LausMeasure[];

/** A LAUS `la.area` area code is a 2-letter type prefix plus 13 digits. */
const LAUS_AREA_CODE_LENGTH = 15;

export interface LausSeriesOptions {
  /** Seasonally adjusted (`S`) vs not (`U`, the default; the only option below state). */
  seasonallyAdjusted?: boolean;
}

/**
 * Build a LAUS series id from a `la.area` area code, a measure, and the seasonal flag.
 * Throws on a malformed area code or unknown measure — the id is built from validated
 * parts, so a bad input fails here rather than as a silent miss at the API.
 */
export function buildLausSeriesId(
  areaCode: string,
  measure: LausMeasure,
  options: LausSeriesOptions = {},
): string {
  if (areaCode.length !== LAUS_AREA_CODE_LENGTH) {
    throw new Error(
      `LAUS area code must be ${LAUS_AREA_CODE_LENGTH} characters (e.g. "CN0803100000000"); got "${areaCode}" (${areaCode.length}).`,
    );
  }
  const code = LAUS_MEASURE_CODES[measure];
  if (!code) {
    throw new Error(
      `unknown LAUS measure "${measure}"; expected one of ${LAUS_MEASURES.join(", ")}.`,
    );
  }
  const seasonal = options.seasonallyAdjusted ? "S" : "U";
  return `LA${seasonal}${areaCode}${code}`;
}

/** True for a well-formed 20-char LAUS series id (`LA` + S/U + 15 + 2). */
export function isLausSeriesId(id: string): boolean {
  return /^LA[SU].{15}(03|04|05|06|07|08|09)$/.test(id);
}

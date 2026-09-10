/**
 * JOLTS (Job Openings and Labor Turnover Survey, "JT") state-level series identifiers, built —
 * never typed (CLAUDE.md). A JT series id is exactly 21 characters:
 *
 *   JT · seasonal(1) · industry(6) · state(2) · area(5) · sizeclass(2) · dataelement(2) · ratelevel(1)
 *
 * M4 exposes the statewide headline series: total nonfarm industry (`000000`), statewide area
 * (`00000`), all size classes (`00`), LEVEL not rate (`L`) — for job openings, hires, quits and
 * layoffs, which differ only by the data-element code. Below national, JOLTS publishes at the
 * state level only (no metro JOLTS). Verified against the live BLS API (Colorado, Dec 2023, NSA,
 * in thousands): job openings `JTU000000080000000JOL` = 188; hires `JTU000000080000000HIL` = 81;
 * quits `JTU000000080000000QUL` = 59; layoffs and discharges `JTU000000080000000LDL` = 31. Both
 * NSA (`U`) and seasonally adjusted (`S`) state series are published.
 */

const JT_TOTAL_NONFARM = "000000"; // industry: total nonfarm
const JT_STATEWIDE_AREA = "00000";
const JT_ALL_SIZE_CLASSES = "00";
const JT_LEVEL = "L"; // rate/level: level, in thousands

/** The JOLTS data elements this server registers — headline counts, all sharing one builder. */
export type JtDataElement = "JO" | "HI" | "QU" | "LD";

export const JT_DATA_ELEMENTS = {
  jobOpenings: "JO",
  hires: "HI",
  quits: "QU",
  layoffs: "LD",
} as const satisfies Record<string, JtDataElement>;

export interface JtSeriesOptions {
  /** Seasonally adjusted (`S`) vs not (`U`, the default). */
  seasonallyAdjusted?: boolean;
}

/**
 * Build a statewide JOLTS headline series id (total nonfarm, all size classes, level) from a
 * 2-digit state FIPS and a data element. Throws on a malformed state code — the id is built from
 * validated parts.
 */
export function buildJtSeriesId(
  stateFips: string,
  element: JtDataElement,
  options: JtSeriesOptions = {},
): string {
  if (!/^\d{2}$/.test(stateFips)) {
    throw new Error(
      `JOLTS state FIPS must be 2 digits (e.g. "08" for Colorado); got "${stateFips}".`,
    );
  }
  const seasonal = options.seasonallyAdjusted ? "S" : "U";
  return `JT${seasonal}${JT_TOTAL_NONFARM}${stateFips}${JT_STATEWIDE_AREA}${JT_ALL_SIZE_CLASSES}${element}${JT_LEVEL}`;
}

/** True for a well-formed 21-char JT series id (`JT` + S/U + 6 + 2 + 5 + 2 + 2 + 1). */
export function isJtSeriesId(id: string): boolean {
  return /^JT[SU]\d{15}[A-Z]{2}[A-Z]$/.test(id);
}

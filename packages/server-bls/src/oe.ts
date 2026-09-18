/**
 * OEWS (Occupational Employment and Wage Statistics, "OE" survey) series identifiers, built —
 * never typed (CLAUDE.md). An OE series id is exactly 25 characters:
 *
 *   OE · seasonal(1) · areatype(1) · area(7) · industry(6) · occupation(6) · datatype(2)
 *
 * OEWS is an annual, unadjusted-only survey (seasonal is always `U`). Two area shapes are
 * supported (ADR-013 §1, §3):
 *   - a state (areatype `S`, area = state FIPS + "00000")
 *   - a metro (areatype `M`, area = the catalog's 7-digit OEWS metro code, read off `oe.area` at
 *     build time — no server-side FIPS table)
 * `oewsCodeOf` (oe-indicators.ts) encodes which shape a resolved place carries as `"S:<fips>"` or
 * `"M:<7-digit code>"`; that string is the `code` this module's builder parses. Industry stays
 * cross-industry (`000000`); data type is always `04` (annual mean wage). Occupation is one of the
 * 22 SOC major groups (2-digit group + "0000"), default `000000` (all occupations) — see
 * `oewsIndicatorDefinitions` in oe-indicators.ts for the published vocabulary.
 *
 * Verified against the live BLS API (no-key GET), 2026-09-17:
 *   - Colorado (state FIPS "08"), all occupations, annual mean wage, 2025 = $77,190
 *     (`OEUS080000000000000000004`).
 *   - Colorado, construction and extraction occupations (470000), annual mean wage, 2025 =
 *     $65,880 (`OEUS080000000000047000004`).
 *   - Denver-Aurora-Centennial metro (CBSA 19740 → OEWS area "0019740"), all occupations, annual
 *     mean wage, 2025 = $81,690 (`OEUM001974000000000000004`).
 * All 22 SOC major groups were then verified in one registered-key query (Colorado, annual mean
 * wage, 2025 data returned for every id): 110000 $165,160 · 130000 $100,650 · 150000 $128,910 ·
 * 170000 $113,860 · 190000 $99,060 · 210000 $66,600 · 230000 $162,080 · 250000 $71,910 ·
 * 270000 $86,930 · 290000 $111,430 · 310000 $46,000 · 330000 $65,990 · 350000 $43,540 ·
 * 370000 $44,960 · 390000 $46,600 · 410000 $65,010 · 430000 $56,100 · 450000 $46,080 ·
 * 470000 $65,880 · 490000 $68,080 · 510000 $56,410 · 530000 $58,350 (2026-09-17).
 */

const OE_AREA_TYPE_STATE = "S";
const OE_AREA_TYPE_METRO = "M";
const OE_CROSS_INDUSTRY = "000000"; // industry: cross-industry (all industries)
const OE_ALL_OCCUPATIONS = "000000"; // occupation: all occupations (SOC 00-0000)
const OE_ANNUAL_MEAN_WAGE = "04"; // data type: annual mean wage

export interface OeSeriesOptions {
  /**
   * OEWS is annual and unadjusted only — this option is accepted for symmetry with other
   * programs' `buildSeriesId` signature but has no effect; the series id is always `U`.
   */
  seasonallyAdjusted?: boolean;
  /** A 6-char SOC major-group occupation code (e.g. "470000"). Defaults to all occupations. */
  occupation?: string;
}

/**
 * Parse an OEWS area spec — `"S:<2-digit state FIPS>"` or `"M:<7-digit OEWS metro code>"` — into
 * the series id's area type flag and 7-char area field. Throws on anything else: the id is built
 * only from validated parts.
 */
function parseOeAreaSpec(spec: string): { areaType: string; area: string } {
  const state = /^S:(\d{2})$/.exec(spec);
  if (state?.[1] !== undefined) {
    return { areaType: OE_AREA_TYPE_STATE, area: `${state[1]}00000` };
  }
  const metro = /^M:(\d{7})$/.exec(spec);
  if (metro?.[1] !== undefined) {
    return { areaType: OE_AREA_TYPE_METRO, area: metro[1] };
  }
  throw new Error(
    `OEWS area spec must be "S:<2-digit state FIPS>" (e.g. "S:08") or "M:<7-digit OEWS metro code>" (e.g. "M:0019740"); got "${spec}".`,
  );
}

/**
 * Build an OEWS series id (mean annual wage) from an area spec — a state (`"S:08"`) or a metro
 * (`"M:0019740"`, the catalog's OEWS area code) — and an optional occupation code (defaults to
 * all occupations). Throws on a malformed area spec or occupation code — the id is built from
 * validated parts.
 */
export function buildOeSeriesId(areaSpec: string, options: OeSeriesOptions = {}): string {
  const { areaType, area } = parseOeAreaSpec(areaSpec);
  const occupation = options.occupation ?? OE_ALL_OCCUPATIONS;
  if (!/^\d{6}$/.test(occupation)) {
    throw new Error(`OEWS occupation code must be 6 digits (e.g. "470000"); got "${occupation}".`);
  }
  return `OEU${areaType}${area}${OE_CROSS_INDUSTRY}${occupation}${OE_ANNUAL_MEAN_WAGE}`;
}

/** True for a well-formed 25-char OE series id (`OE` + `U` + area type + 21 digits). */
export function isOeSeriesId(id: string): boolean {
  return /^OEU[MSN]\d{21}$/.test(id);
}

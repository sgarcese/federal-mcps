import VENDORED_OE_OCCUPATIONS from "./data/oe-occupations.json" with { type: "json" };

/**
 * OEWS (Occupational Employment and Wage Statistics, "OE" survey) series identifiers, built —
 * never typed (CLAUDE.md). An OE series id is exactly 25 characters:
 *
 *   OE · seasonal(1) · areatype(1) · area(7) · industry(6) · occupation(6) · datatype(2)
 *
 * OEWS is an annual, unadjusted-only survey (seasonal is always `U`). Three area shapes are
 * supported (ADR-013 §1, §3; #290):
 *   - the nation (areatype `N`, area "0000000")
 *   - a state (areatype `S`, area = state FIPS + "00000")
 *   - a metro (areatype `M`, area = the catalog's 7-digit OEWS metro code, read off `oe.area` at
 *     build time — no server-side FIPS table)
 * `oewsCodeOf` (oe-indicators.ts) encodes which shape a resolved place carries as `"N"`,
 * `"S:<fips>"` or `"M:<7-digit code>"`; that string is the `code` this module's builder parses.
 * Industry stays cross-industry (`000000`). Data type (`statistic`, #359) defaults to `04`
 * (annual mean wage) and otherwise must be one of `OE_DATA_TYPES` below — BLS's own `oe.datatype`
 * vocabulary, read 2026-10-15. Occupation is one of the 22 SOC major groups (2-digit group +
 * "0000", curated in `oewsIndicatorDefinitions`, oe-indicators.ts) or any detailed 6-digit SOC
 * code BLS's own OE occupation list publishes (#359) — vendored, not typed, at
 * `data/oe-occupations.json` (`scripts/generate-oe-occupations.mts`, retrieved 2026-10-15: 23
 * major groups, 830 detailed occupations). Default occupation is `000000` (all occupations).
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
 *
 * The 10 additional data types (#359) were verified live 2026-10-15 (Indiana, state FIPS "18",
 * all occupations, 2025 data): 01 employment = 3,201,220 · 03 hourly mean wage = $29.25 · 08
 * hourly median wage = $23.01 · 11 annual 10th percentile = $29,120 · 12 annual 25th percentile =
 * $36,500 · 13 annual median = $47,860 · 14 annual 75th percentile = $72,000 · 15 annual 90th
 * percentile = $101,160 · 16 employment per 1,000 jobs = 1000.000 (statewide, always 1,000 of
 * itself) · 17 location quotient = 1.00 (statewide, always 1.00). A detailed occupation
 * (carpenters, 472031) and a metro (Denver-Aurora-Centennial) were verified together: Indiana
 * carpenters annual mean wage = $64,950 (`OEUS180000000000047203104`); Denver registered nurses
 * (291141) annual median wage = $101,130 (`OEUM001974000000029114113`), annual 90th percentile =
 * $125,870 (`OEUM001974000000029114115`).
 */

const OE_AREA_TYPE_NATION = "N";
const OE_AREA_TYPE_STATE = "S";
const OE_AREA_TYPE_METRO = "M";
const OE_CROSS_INDUSTRY = "000000"; // industry: cross-industry (all industries)
const OE_ALL_OCCUPATIONS = "000000"; // occupation: all occupations (SOC 00-0000)
const OE_ANNUAL_MEAN_WAGE = "04"; // data type: annual mean wage (the default, unchanged)

/**
 * BLS's `oe.datatype` vocabulary (#359, read 2026-10-15): wage statistics (dollars) and
 * employment statistics (counts/ratios) share the same data-type axis in the series id, but are
 * registered as two separate indicators (`oewsIndicatorDefinitions`, oe-indicators.ts) because
 * they are not the same kind of number — a picker that let "employment" sit next to "annual
 * mean wage" under one `occupational_wage` indicator would answer a wage question with a head
 * count. `kind` is what the envelope's units are for each code: `wage` is always dollars (annual
 * or hourly, per `label`); `count` and `ratio` are never dollars.
 */
export const OE_DATA_TYPES: Readonly<
  Record<string, { label: string; kind: "wage" | "count" | "ratio" }>
> = Object.freeze({
  "01": { label: "employment", kind: "count" },
  "03": { label: "hourly mean wage", kind: "wage" },
  "04": { label: "annual mean wage", kind: "wage" },
  "08": { label: "hourly median wage", kind: "wage" },
  "11": { label: "annual 10th percentile wage", kind: "wage" },
  "12": { label: "annual 25th percentile wage", kind: "wage" },
  "13": { label: "annual median wage", kind: "wage" },
  "14": { label: "annual 75th percentile wage", kind: "wage" },
  "15": { label: "annual 90th percentile wage", kind: "wage" },
  "16": { label: "employment per 1,000 jobs", kind: "ratio" },
  "17": { label: "location quotient", kind: "ratio" },
});

interface OeOccupationRow {
  readonly code: string;
  readonly name: string;
}
interface OeOccupationVocabulary {
  readonly majorGroups: readonly OeOccupationRow[];
  readonly detailed: readonly OeOccupationRow[];
}
const OE_OCCUPATIONS = VENDORED_OE_OCCUPATIONS as OeOccupationVocabulary;

/** Every occupation code BLS's OE survey defines — major groups and detailed — code → name. */
const OE_OCCUPATION_NAMES = new Map<string, string>(
  [...OE_OCCUPATIONS.majorGroups, ...OE_OCCUPATIONS.detailed].map((r) => [r.code, r.name]),
);

/**
 * The major group a detailed (or malformed) occupation code falls under, by its leading 2 digits
 * — for the "nearest published level" validation message (#359). Undefined when even that major
 * group does not exist (a code outside the SOC major-group range).
 */
function nearestMajorGroup(code: string): { code: string; name: string } | undefined {
  const major = `${code.slice(0, 2)}0000`;
  const name = OE_OCCUPATION_NAMES.get(major);
  return name === undefined ? undefined : { code: major, name };
}

/**
 * True for a code BLS's OE survey actually publishes — one of the 22 major groups (curated in
 * `oewsIndicatorDefinitions`) or one of the ~830 detailed 6-digit SOC codes (#359, "built, not
 * typed": read from `data/oe-occupations.json`, never a hand-typed table).
 */
function isPublishedOccupation(code: string): boolean {
  return OE_OCCUPATION_NAMES.has(code);
}

export interface OeSeriesOptions {
  /**
   * OEWS is annual and unadjusted only — this option is accepted for symmetry with other
   * programs' `buildSeriesId` signature but has no effect; the series id is always `U`.
   */
  seasonallyAdjusted?: boolean;
  /**
   * A 6-digit SOC occupation code: one of the 22 major groups (e.g. "470000") or any detailed
   * code BLS's OE survey publishes (e.g. "472031", carpenters; #359). Defaults to all
   * occupations. An unpublished code is rejected naming its nearest major group.
   */
  occupation?: string;
  /** A 2-digit `oe.datatype` code (#359); see `OE_DATA_TYPES`. Defaults to annual mean wage. */
  statistic?: string;
}

/**
 * Parse an OEWS area spec — `"S:<2-digit state FIPS>"` or `"M:<7-digit OEWS metro code>"` — into
 * the series id's area type flag and 7-char area field. Throws on anything else: the id is built
 * only from validated parts.
 */
function parseOeAreaSpec(spec: string): { areaType: string; area: string } {
  // The nation (#290): area type N, area 0000000 — OEUN000000000000000000004, recorded 2026-09-30
  // (2025 annual mean wage, all occupations = $69,770).
  if (spec === OE_AREA_TYPE_NATION) return { areaType: OE_AREA_TYPE_NATION, area: "0000000" };
  const state = /^S:(\d{2})$/.exec(spec);
  if (state?.[1] !== undefined) {
    return { areaType: OE_AREA_TYPE_STATE, area: `${state[1]}00000` };
  }
  const metro = /^M:(\d{7})$/.exec(spec);
  if (metro?.[1] !== undefined) {
    return { areaType: OE_AREA_TYPE_METRO, area: metro[1] };
  }
  throw new Error(
    `OEWS area spec must be "N" (the nation), "S:<2-digit state FIPS>" (e.g. "S:08") or "M:<7-digit OEWS metro code>" (e.g. "M:0019740"); got "${spec}".`,
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
  if (!isPublishedOccupation(occupation)) {
    const nearest = nearestMajorGroup(occupation);
    throw new Error(
      nearest
        ? `OEWS does not publish occupation "${occupation}"; the nearest published level is its major group ${nearest.code} (${nearest.name.toLowerCase()}). See bls_list_indicators.`
        : `OEWS does not publish occupation "${occupation}" and it has no corresponding SOC major group.`,
    );
  }
  const statistic = options.statistic ?? OE_ANNUAL_MEAN_WAGE;
  if (!(statistic in OE_DATA_TYPES)) {
    throw new Error(
      `OEWS statistic "${statistic}" is not one of BLS's oe.datatype codes; accepted: ${Object.keys(OE_DATA_TYPES).join(", ")}.`,
    );
  }
  return `OEU${areaType}${area}${OE_CROSS_INDUSTRY}${occupation}${statistic}`;
}

/** True for a well-formed 25-char OE series id (`OE` + `U` + area type + 21 digits). */
export function isOeSeriesId(id: string): boolean {
  return /^OEU[MSN]\d{21}$/.test(id);
}

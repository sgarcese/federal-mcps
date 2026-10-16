import type {
  BuildSeriesIdOptions,
  DimensionDefinition,
  IndicatorDefinition,
  PlaceCandidate,
} from "@federal-mcps/core";
import { isNation } from "./nation.js";
import { buildOeSeriesId, OE_DATA_TYPES } from "./oe.js";

/**
 * OEWS (OE) registered as two indicator definitions (ADR-010 §1–§2, ADR-013 §1, §3; #359):
 * `occupational_wage` (dollars: mean/median/percentile, annual or hourly) and
 * `occupational_employment` (not wages: a head count, a per-1,000 ratio, or a location
 * quotient). BLS packs both kinds of number onto the same `oe.datatype` axis of the series id,
 * but a picker that let "employment" sit beside "annual mean wage" in one `statistic`
 * vocabulary would let a caller ask occupational_wage's question and get a head count back — so
 * they are two indicators, sharing the same series builder and occupation vocabulary, each with
 * its own `statistic` vocabulary restricted to the kind of number its name promises (CLAUDE.md:
 * "numbers carry their caveats" — including their unit). A state resolves to its own FIPS
 * geoid, a metro (CBSA) to the OEWS metro code the geography catalog already carries (`oe.area`,
 * sumlevel 310) — no server-side FIPS or CBSA table. `occupation` is a named dimension: the 22
 * SOC major groups are curated vocabulary (ADR-013 §2); any detailed 6-digit SOC code BLS's OE
 * survey publishes also works (#359, `acceptsCode`, vendored in `data/oe-occupations.json` —
 * built, not typed) — an unpublished code is rejected by `buildOeSeriesId` naming its nearest
 * major group, so the readable 23-entry vocabulary below never has to enumerate the ~830
 * detailed codes.
 */
const OEWS_PROGRAM = "OEWS";
const STATE_SUMLEVEL = "040";
const METRO_SUMLEVEL = "310";

/**
 * The OEWS "agency code" for a place, encoding which area shape `buildOeSeriesId` should build: a
 * state's FIPS geoid as `"S:<fips>"`, or a metro's catalog-held OEWS area code as `"M:<code>"`.
 * Undefined for any other place (no fabrication) or a metro without a stored OEWS code.
 */
export function oewsCodeOf(place: PlaceCandidate): string | undefined {
  if (isNation(place)) return "N"; // the national estimate, area type N (#290)
  if (place.kind.sumlevel === STATE_SUMLEVEL) {
    return `S:${place.geoid}`;
  }
  if (place.kind.sumlevel === METRO_SUMLEVEL) {
    const code = place.agencyCodes.find(
      (c) => c.agency === "bls" && c.program === OEWS_PROGRAM,
    )?.code;
    return code === undefined ? undefined : `M:${code}`;
  }
  return undefined;
}

/**
 * The 22 SOC major groups, as 6-char OEWS occupation codes (2-digit major group + "0000"), plus
 * the "000000" all-occupations code, which is also the default (ADR-013 §2). Every code verified
 * against the live BLS API on 2026-09-17 (Colorado, 2025 data) — see oe.ts's header. `acceptsCode`
 * additionally admits any 6-digit code (#359); `buildOeSeriesId` is what actually validates it
 * against BLS's own detailed-occupation list and rejects an unpublished one naming its nearest
 * major group — this dimension's job is only the readable vocabulary, not the real check,
 * exactly as QCEW's `INDUSTRY_DIMENSION` (qcew-indicators.ts) separates the two.
 */
const OCCUPATION_DIMENSION: DimensionDefinition = {
  argument: "occupation",
  description:
    "SOC major occupation group, or any detailed 6-digit SOC occupation code BLS's OEWS publishes (e.g. 472031 carpenters); an unpublished code is rejected naming its major group.",
  default: "000000",
  acceptsCode: (code) => /^\d{6}$/.test(code),
  openCodes:
    "any published 6-digit SOC detailed occupation code (BLS's OE survey publishes about 830; bls_describe_source names the list)",
  vocabulary: [
    { code: "000000", label: "all occupations" },
    { code: "110000", label: "management" },
    { code: "130000", label: "business and financial operations" },
    { code: "150000", label: "computer and mathematical" },
    { code: "170000", label: "architecture and engineering" },
    { code: "190000", label: "life, physical, and social science" },
    { code: "210000", label: "community and social service" },
    { code: "230000", label: "legal" },
    { code: "250000", label: "educational instruction and library" },
    { code: "270000", label: "arts, design, entertainment, sports, and media" },
    { code: "290000", label: "healthcare practitioners and technical" },
    { code: "310000", label: "healthcare support" },
    { code: "330000", label: "protective service" },
    { code: "350000", label: "food preparation and serving related" },
    { code: "370000", label: "building and grounds cleaning and maintenance" },
    { code: "390000", label: "personal care and service" },
    { code: "410000", label: "sales and related" },
    { code: "430000", label: "office and administrative support" },
    { code: "450000", label: "farming, fishing, and forestry" },
    { code: "470000", label: "construction and extraction" },
    { code: "490000", label: "installation, maintenance, and repair" },
    { code: "510000", label: "production" },
    { code: "530000", label: "transportation and material moving" },
  ],
};

/** `oe.datatype` codes restricted to `kind: "wage"` — dollars, never a count or ratio (#359). */
const WAGE_STATISTIC_CODES = Object.entries(OE_DATA_TYPES)
  .filter(([, v]) => v.kind === "wage")
  .map(([code, v]) => ({ code, label: v.label }));

/** `oe.datatype` codes restricted to `kind` other than wage — never dollars (#359). */
const EMPLOYMENT_STATISTIC_CODES = Object.entries(OE_DATA_TYPES)
  .filter(([, v]) => v.kind !== "wage")
  .map(([code, v]) => ({ code, label: v.label }));

const WAGE_STATISTIC_DIMENSION: DimensionDefinition = {
  argument: "statistic",
  description:
    "Which wage statistic: annual or hourly mean/median, or an annual 10th/25th/75th/90th percentile. Defaults to annual mean wage.",
  default: "04",
  vocabulary: WAGE_STATISTIC_CODES,
};

const EMPLOYMENT_STATISTIC_DIMENSION: DimensionDefinition = {
  argument: "statistic",
  description:
    "Which employment statistic: a head count, employment per 1,000 jobs, or a location quotient (the area's concentration of the occupation relative to the nation; 1.00 = the same). Defaults to employment.",
  default: "01",
  vocabulary: EMPLOYMENT_STATISTIC_CODES,
};

function buildOewsKey(
  code: string,
  { seasonallyAdjusted, dimensions }: BuildSeriesIdOptions,
): string {
  return buildOeSeriesId(code, {
    seasonallyAdjusted,
    ...(dimensions.occupation === undefined ? {} : { occupation: dimensions.occupation }),
    ...(dimensions.statistic === undefined ? {} : { statistic: dimensions.statistic }),
  });
}

/**
 * OEWS wage and employment statistics by occupation, NSA by default (ADR-010 §5; #359: split
 * into two indicators — see the module comment for why).
 */
export const oewsIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "occupational_wage",
    program: OEWS_PROGRAM,
    description:
      "Wage by occupation (Occupational Employment and Wage Statistics): annual mean (default), annual median, an annual percentile, or hourly mean/median. Defaults to all occupations.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: oewsCodeOf,
    buildSeriesId: buildOewsKey,
    dimensions: [OCCUPATION_DIMENSION, WAGE_STATISTIC_DIMENSION],
    // The BLS API holds only the current OEWS year: a requested range is stated as not applied (#214).
    servesHistory: false,
  },
  {
    name: "occupational_employment",
    program: OEWS_PROGRAM,
    description:
      "Employment by occupation (Occupational Employment and Wage Statistics): a head count (default), employment per 1,000 jobs, or a location quotient. Not a wage — see occupational_wage for pay. Defaults to all occupations.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: oewsCodeOf,
    buildSeriesId: buildOewsKey,
    dimensions: [OCCUPATION_DIMENSION, EMPLOYMENT_STATISTIC_DIMENSION],
    servesHistory: false,
  },
];

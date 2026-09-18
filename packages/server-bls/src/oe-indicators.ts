import type { PlaceCandidate } from "@federal-mcps/core";
import { buildOeSeriesId } from "./oe.js";
import type { DimensionDefinition, IndicatorDefinition } from "./registry.js";

/**
 * OEWS (OE) registered as an indicator definition (ADR-010 §1–§2, ADR-013 §1, §3). The headline
 * is mean annual wage across all industries and occupations; a state resolves to its own FIPS
 * geoid, a metro (CBSA) to the OEWS metro code the geography catalog already carries (`oe.area`,
 * sumlevel 310) — no server-side FIPS or CBSA table. `occupation` is a named dimension over the
 * 22 SOC major groups (ADR-013 §2).
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
 * the "000000" all-occupations code, which is also the default (ADR-013 §2). Verified against the
 * live BLS API (no-key GET),
 * 2026-09-17: 000000 (Colorado, $77,190) and 470000 (Colorado, $65,880) — see oe.ts's header for
 * the full verification note.
 */
const OCCUPATION_DIMENSION: DimensionDefinition = {
  argument: "occupation",
  description: "SOC major occupation group.",
  default: "000000",
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

/** OEWS occupational mean annual wage (all industries), NSA by default (ADR-010 §5). */
export const oewsIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "occupational_wage",
    program: OEWS_PROGRAM,
    description:
      "Mean annual wage across industries, by occupation (Occupational Employment and Wage Statistics). Defaults to all occupations.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: oewsCodeOf,
    buildSeriesId: (code, { seasonallyAdjusted, dimensions }) =>
      buildOeSeriesId(code, {
        seasonallyAdjusted,
        ...(dimensions.occupation === undefined ? {} : { occupation: dimensions.occupation }),
      }),
    dimensions: [OCCUPATION_DIMENSION],
  },
];

import type { ProgramDescription, SourceDescription } from "@federal-mcps/core";

/** The Census Data API base (ADR-014 §9); every dataset hangs off `/{vintage}/{dataset}`. */
export const CENSUS_API_ENDPOINT = "https://api.census.gov/data";

/** The sentence the Census Data API terms of service require products to display (docs/licensing.md). */
export const CENSUS_API_REQUIRED_SENTENCE =
  "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.";

/**
 * Backs the auto-registered `census_describe_source` tool. Programs flip to `available` as
 * M8.4 lands their indicators; until then the server only resolves places.
 */
const PROGRAMS: readonly ProgramDescription[] = [
  {
    code: "ACS1",
    name: "American Community Survey 1-year estimates",
    granularity:
      "areas with 65,000 or more people: nation, region, division, state, county, place, metro, county subdivision, congressional district; smaller places fall back to the 5-year product, flagged",
    cadence: "annual (latest vintage 2024)",
    status: "planned",
  },
  {
    code: "ACS5",
    name: "American Community Survey 5-year estimates",
    granularity: "every area down to tract and ZCTA; a five-year period (latest 2020–2024)",
    cadence: "annual",
    status: "planned",
  },
  {
    code: "DEC",
    name: "Decennial Census (2020 redistricting counts)",
    granularity: "every area; total population with no margin of error",
    cadence: "decennial",
    status: "planned",
  },
];

const CAVEATS: readonly string[] = [
  CENSUS_API_REQUIRED_SENTENCE,
  "Every ACS value is an estimate with a margin of error (90% confidence); the envelope carries it " +
    "and a reliability grade. Read them before quoting a number for a small place.",
  "ACS 1-year estimates exist only for areas of 65,000 or more people; smaller places are answered " +
    "from the 5-year product, which covers a five-year period, and the answer says so.",
  "Some cells carry Census annotation values rather than numbers (insufficient sample, not " +
    "applicable, controlled estimates); they come back as null with the Census meaning, never a number.",
  "SAIPE (annual model-based county poverty and income) and the Population Estimates Program are " +
    "not served here yet; the Population Estimates API series ends at vintage 2021.",
];

export function describeSource(): SourceDescription {
  return {
    agency: "census",
    agencyName: "U.S. Census Bureau",
    homepage: "https://www.census.gov",
    programs: PROGRAMS,
    quota:
      "Census Data API: a registered key is required for every data query (set as CENSUS_API_KEY); " +
      "no published daily cap, but keys are rate-limited and responses are cached per vintage",
    caveats: CAVEATS,
    citationFormat:
      "U.S. Census Bureau, <program> <vintage>, table <id>. Retrieved <date> from https://api.census.gov/data.",
  };
}

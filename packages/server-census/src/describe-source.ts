import type { ProgramDescription, SourceDescription } from "@federal-mcps/core";
import { TABLE_INDEX_RETRIEVED_AT } from "./table-index.js";

/** The Census Data API base (ADR-014 §9); every dataset hangs off `/{vintage}/{dataset}`. */
export const CENSUS_API_ENDPOINT = "https://api.census.gov/data";

/** The public, keyless dataset catalog `census_search_tables`'s index is derived from (§7). */
export const CENSUS_DATA_JSON_URL = "https://api.census.gov/data.json";

/**
 * `census_search_tables`'s citation. Names a fixed retrieval date, not `now()`: the index is a
 * vendored snapshot (`data/table-index.json.gz`, `data/README.md`), only as fresh as the last
 * `build-table-index.mts` run.
 */
export function censusTableIndexCitation(): string {
  return (
    "U.S. Census Bureau Data API dataset and group metadata (api.census.gov/data.json), " +
    `retrieved ${TABLE_INDEX_RETRIEVED_AT}`
  );
}

/** The sentence the Census Data API terms of service require products to display (docs/licensing.md). */
export const CENSUS_API_REQUIRED_SENTENCE =
  "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.";

/**
 * Backs the auto-registered `census_describe_source` tool (M8.4: ACS 1-year, ACS 5-year and the
 * 2020 decennial count are served through `census_get_indicator`).
 */
const PROGRAMS: readonly ProgramDescription[] = [
  {
    code: "ACS1",
    name: "American Community Survey 1-year estimates",
    granularity:
      "areas with 65,000 or more people: nation, region, division, state, county, place, metro, county subdivision, congressional district; smaller places fall back to the 5-year product, flagged",
    cadence: "annual (latest vintage 2024)",
    status: "available",
  },
  {
    code: "ACS5",
    name: "American Community Survey 5-year estimates",
    granularity: "every area down to tract and ZCTA; a five-year period (latest 2020–2024)",
    cadence: "annual",
    status: "available",
  },
  {
    code: "DEC",
    name: "Decennial Census (2020 redistricting counts)",
    granularity: "every area; total population with no margin of error",
    cadence: "decennial",
    status: "available",
  },
  {
    code: "TABLES",
    name: "Table index (ACS and decennial groups)",
    granularity: "table ids by topic, for census_get_raw",
    cadence: "regenerated with the index script",
    status: "available",
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

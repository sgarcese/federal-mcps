import type { ProgramDescription, SourceDescription } from "@federal-mcps/core";

/**
 * Backs the shell's auto-registered `bls_describe_source` tool
 * (`packages/core/src/server/create-server.ts`). This is a source-declaration
 * file (`packages/core/src/testing/static-checks.ts`
 * `SOURCE_DECLARATION_FILES`): it is the one place in this package allowed to
 * name `bls.gov` hosts, because it only describes the source — it never
 * fetches from it.
 *
 * Coverage and cadence come from `docs/architecture.md` ("Server one: BLS").
 * LAUS (M3, ADR-009) and CES/OEWS/CPI/JOLTS (M4, ADR-010) are `available` through
 * `bls_get_indicator`; QCEW is still `planned` (M5, its own CSV client).
 * The threshold, CPI-coverage and QCEW-format caveats come from
 * `docs/spikes/geography-catalog.md` ("Gotchas the build must handle").
 */

/**
 * The BLS Public Data API v2 timeseries endpoint. Declared here (a source-declaration file)
 * because agency hostnames live only where the source is described (contract rule
 * static-no-agency-hostname); the fetch layer imports it and calls it through the core client.
 */
export const BLS_TIMESERIES_ENDPOINT = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

const PROGRAMS: readonly ProgramDescription[] = [
  {
    code: "LAUS",
    name: "Local Area Unemployment Statistics",
    granularity:
      "state, metro (CBSA), county, city (incorporated places with population 25,000 or more)",
    cadence: "monthly",
    status: "available",
  },
  {
    code: "SM",
    name: "Current Employment Statistics, State & Area",
    granularity: "state and single-state metro (CBSA), total nonfarm",
    cadence: "monthly",
    status: "available",
  },
  {
    code: "QCEW",
    name: "Quarterly Census of Employment and Wages",
    granularity: "county, metro (CBSA), state, by NAICS industry and ownership",
    cadence: "quarterly, with an annual average release",
    status: "planned",
  },
  {
    code: "OEWS",
    name: "Occupational Employment and Wage Statistics",
    granularity: "state (metro/CBSA planned), all-occupations mean annual wage",
    cadence: "annual",
    status: "available",
  },
  {
    code: "CPI",
    name: "Consumer Price Index",
    granularity:
      "U.S. city average, census region, census division, and about 23 named metro areas",
    cadence:
      "monthly nationally; many of the ~23 metro-area indexes publish bimonthly or semiannually",
    status: "available",
  },
  {
    code: "JOLTS",
    name: "Job Openings and Labor Turnover Survey",
    granularity: "state; openings, hires, quits, layoffs and discharges",
    cadence: "monthly",
    status: "available",
  },
];

const CAVEATS: readonly string[] = [
  "bls_get_indicator returns a statistic for a resolved place across five programs now: LAUS " +
    "(unemployment rate, unemployment, employment, labor force), CES State & Area (payroll " +
    "employment), OEWS (occupational wage), CPI (all items) and JOLTS (job openings, hires, quits, " +
    "layoffs). bls_list_indicators lists the vocabulary and which programs publish at a place's level; " +
    "bls_compare_places compares one indicator across places; bls_get_raw returns the unprocessed BLS " +
    "response. Place resolution (bls_resolve_place) maps a name to candidates with identifiers, BLS " +
    "area codes and structured flags (e.g. below_threshold with the county fallback). QCEW is the one " +
    "program below still planned (M5, its own CSV client).",
  "LAUS publishes a city-level series only for incorporated places with population 25,000 or more " +
    "(about 1,700 places), plus New England towns via county-subdivision codes; smaller places have no " +
    "city series and must fall back to their county.",
  "Most cities have no local CPI: CPI publishes for the U.S. city average, census regions and " +
    "divisions, and roughly 23 named metro areas, not for most municipalities or counties.",
  "QCEW is distributed as CSV data slices (data.bls.gov/cew/data/api), not the standard BLS timeseries " +
    "API used by the other programs here; it has its own parsing, suppression codes and update cadence.",
  "Values may carry preliminary or revised flags in the underlying footnote codes; check a result's " +
    "footnotes before treating a number as final.",
];

export function describeSource(): SourceDescription {
  return {
    agency: "bls",
    agencyName: "U.S. Bureau of Labor Statistics",
    homepage: "https://www.bls.gov",
    programs: PROGRAMS,
    quota:
      "BLS Public Data API v2: 500 queries/day with a registered key, 50 series and 20 years per query",
    caveats: CAVEATS,
    citationFormat:
      "U.S. Bureau of Labor Statistics, <program>, series <id>. Retrieved <date> from <url>.",
  };
}

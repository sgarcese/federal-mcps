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
 * `bls_get_indicator`. QCEW (M5, ADR-011) is available too, over its own CSV data-slice client.
 * The threshold, CPI-coverage and QCEW-format caveats come from
 * `docs/spikes/geography-catalog.md` ("Gotchas the build must handle").
 */

/**
 * The BLS Public Data API v2 timeseries endpoint. Declared here (a source-declaration file)
 * because agency hostnames live only where the source is described (contract rule
 * static-no-agency-hostname); the fetch layer imports it and calls it through the core client.
 */
export const BLS_TIMESERIES_ENDPOINT = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

/**
 * The QCEW open CSV data-slice API base (ADR-011 §1). QCEW is not on the timeseries API; an area's
 * quarter is fetched as `<base>/<year>/<qtr>/area/<area>.csv`. Declared here (a source-declaration
 * file) so the agency hostname lives only where the source is described (static-no-agency-hostname);
 * the QCEW client imports it. Open data, no key, no daily cap.
 */
export const QCEW_ENDPOINT = "https://data.bls.gov/cew/data/api";

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
    granularity:
      "state and metro (CBSA; a multi-state metro is filed under its first state, flagged), total nonfarm",
    cadence: "monthly",
    status: "available",
  },
  {
    code: "QCEW",
    name: "Quarterly Census of Employment and Wages",
    granularity:
      "county, state and metro; by NAICS industry (sector, or any 3- to 6-digit code) and ownership, default all industries total covered; quarterly or annual averages, from 2014",
    cadence: "quarterly, with an annual average release",
    status: "available",
  },
  {
    code: "OEWS",
    name: "Occupational Employment and Wage Statistics",
    granularity:
      "state and metro (CBSA); mean annual wage by SOC major group (occupation), default all occupations; detailed 6-digit occupations, medians and percentiles through bls_get_raw",
    cadence: "annual",
    status: "available",
  },
  {
    code: "CPI",
    name: "Consumer Price Index",
    granularity:
      "about 23 named metro areas, census divisions and regions, and the U.S. city average; by expenditure group (item)",
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
  {
    code: "PPI",
    name: "Producer Price Index",
    granularity:
      "national only (no state or metro PPI); final demand and commodity indexes such as inputs to construction, lumber, steel, concrete",
    cadence: "monthly",
    status: "available",
  },
];

const CAVEATS: readonly string[] = [
  "bls_get_indicator returns a statistic for a resolved place across the timeseries programs: LAUS " +
    "(unemployment rate, unemployment, employment, labor force), CES State & Area (payroll " +
    "employment), OEWS (occupational wage), CPI (all items) and JOLTS (job openings, hires, quits, " +
    "layoffs). bls_list_indicators lists the vocabulary and which programs publish at a place's level; " +
    "bls_compare_places compares one indicator across places; bls_get_raw returns the unprocessed BLS " +
    "response. Place resolution (bls_resolve_place) maps a name to candidates with identifiers, BLS " +
    "area codes and structured flags (e.g. below_threshold with the county fallback). All seven BLS " +
    "programs are available: QCEW (covered employment and average weekly wage, county, state and metro) " +
    "is fetched from its own CSV data-slice API, not the timeseries API; PPI (producer_price_index) " +
    "is national only — place is optional and, when given, only names the caveat.",
  "Producer prices — including construction material prices — are published nationally only (PPI); " +
    "there is no state or metro PPI. Construction labor cost by place is QCEW construction-sector " +
    "(industry 23) wages and employment.",
  "LAUS publishes a city-level series only for incorporated places with population 25,000 or more " +
    "(about 1,700 places), plus New England towns via county-subdivision codes; smaller places have no " +
    "city series and must fall back to their county.",
  "Most cities have no local CPI: CPI publishes for the U.S. city average, census regions and " +
    "divisions, and roughly 23 named metro areas, not for most municipalities or counties.",
  "OEWS through bls_get_raw: a series id is OEU + area type (S state, M metro, N national) + a " +
    "7-digit area (state FIPS + 00000, or 00 + the CBSA) + a 6-digit industry (000000 = all) + a " +
    "6-digit SOC occupation (any detailed code, e.g. 472031 carpenters) + a 2-digit data type (01 " +
    "employment, 03 hourly mean, 04 annual mean, 08 hourly median, 13 annual median, 11/12/14/15 " +
    "annual percentiles). Example: OEUM004378000000047203113 is carpenters' annual median wage in " +
    "the South Bend-Mishawaka metro. The BLS API holds only the current OEWS year; earlier years " +
    "are in BLS's annual OEWS files, not the API, so a year range returns the current year only.",
  "QCEW is distributed as CSV data slices (data.bls.gov/cew/data/api), not the standard BLS timeseries " +
    "API used by the other programs here; it has its own parsing, suppression codes and update cadence. " +
    "Without startYear/endYear an answer is the latest published quarter; with them, every published " +
    "quarter (or, with frequency annual, every annual average) in the range, from 2014, at most five " +
    "years of quarters per call. Metro and annual files publish later than county and state quarters.",
  "Values may carry preliminary or revised flags in the underlying footnote codes; check a result's " +
    "footnotes before treating a number as final.",
  "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been " +
    "retrieved from BLS.gov (BLS API terms of service); every result carries its retrieval date and " +
    "citation for that reason.",
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

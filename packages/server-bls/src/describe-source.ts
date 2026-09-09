import type { ProgramDescription, SourceDescription } from "@federal-mcps/core";

/**
 * Backs the shell's auto-registered `bls_describe_source` tool
 * (`packages/core/src/server/create-server.ts`). This is a source-declaration
 * file (`packages/core/src/testing/static-checks.ts`
 * `SOURCE_DECLARATION_FILES`): it is the one place in this package allowed to
 * name `bls.gov` hosts, because it only describes the source — it never
 * fetches from it.
 *
 * Coverage and cadence come from `docs/architecture.md` ("Server one: BLS");
 * every program is `planned` in M1 (issue #8) — none has a working tool yet.
 * The threshold, CPI-coverage and QCEW-format caveats come from
 * `docs/spikes/geography-catalog.md` ("Gotchas the build must handle").
 */

const PROGRAMS: readonly ProgramDescription[] = [
  {
    code: "LAUS",
    name: "Local Area Unemployment Statistics",
    granularity:
      "state, metro (CBSA), county, city (incorporated places with population 25,000 or more)",
    cadence: "monthly",
    status: "planned",
  },
  {
    code: "SM",
    name: "Current Employment Statistics, State & Area",
    granularity: "state, metro (CBSA), by supersector",
    cadence: "monthly",
    status: "planned",
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
    granularity: "state, metro (CBSA), by SOC occupation; percentiles, mean, employment",
    cadence: "annual",
    status: "planned",
  },
  {
    code: "CPI",
    name: "Consumer Price Index",
    granularity:
      "U.S. city average, census region, census division, and about 23 named metro areas",
    cadence:
      "monthly nationally; many of the ~23 metro-area indexes publish bimonthly or semiannually",
    status: "planned",
  },
  {
    code: "JOLTS",
    name: "Job Openings and Labor Turnover Survey",
    granularity: "state; openings, hires, quits, layoffs and discharges",
    cadence: "monthly",
    status: "planned",
  },
];

const CAVEATS: readonly string[] = [
  "Place resolution is available now (bls_resolve_place): it maps a name to candidates with " +
    "identifiers, BLS area codes, which programs publish at the place's level, and structured flags " +
    "(e.g. below_threshold with the county fallback). Data-fetching tools for the programs below are " +
    "still planned.",
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

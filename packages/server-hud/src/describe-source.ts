import type { ProgramDescription, SourceDescription } from "@federal-mcps/core";

/**
 * The HUD User Data API base (ADR-018 §1, §6; docs/spikes/m11-hud-user-server.md). Declared
 * only here — the contract's static check forbids agency hostnames outside a source
 * declaration file, and every upstream call this server later makes builds off this constant
 * through the core HTTP client, never a literal.
 */
export const HUD_USER_API_ENDPOINT = "https://www.huduser.gov/hudapi/public";

/**
 * The sentence HUD User's terms of service require products built on the API to display
 * (docs/spikes/m11-hud-user-server.md, ADR-018 §7). Reused verbatim in the server
 * instructions, in every citation and in describe_source.
 */
export const HUD_USER_REQUIRED_SENTENCE =
  "This product uses the HUD User Data API but is not endorsed or certified by HUD User.";

/**
 * Backs the auto-registered `hud_describe_source` tool (M11, ADR-018 §1): every program is
 * queryable through `hud_get_indicator` and `hud_get_raw` (#233–#237).
 */
const PROGRAMS: readonly ProgramDescription[] = [
  {
    code: "FMR",
    name: "Fair Market Rents",
    granularity:
      "county, metropolitan area, New England town; Small Area FMRs additionally by ZIP code",
    cadence: "annual (FY2017 on)",
    status: "available",
  },
  {
    code: "IL",
    name: "Income Limits and Multifamily Tax Subsidy Project (MTSP) limits",
    granularity: "county, metropolitan area",
    cadence: "annual (FY2017 on)",
    status: "available",
  },
  {
    code: "CHAS",
    name: "Comprehensive Housing Affordability Strategy (cost burden)",
    granularity: "state, county, place",
    cadence: "multi-year releases (2012–2016 through 2018–2022)",
    status: "available",
  },
  {
    code: "PICTURE",
    name: "Picture of Subsidized Households",
    granularity: "county, place, tract, CBSA, state",
    cadence: "annual (2012–2025)",
    status: "available",
  },
];

const CAVEATS: readonly string[] = [
  HUD_USER_REQUIRED_SENTENCE,
  "Fair Market Rents and Income Limits are set per county or HUD metro area; a city or township " +
    "answers with its county's area, stated in the caveats. New England sets them by town: a town " +
    "answers directly, a city with its town, and a county not at all (#241). Connecticut towns " +
    "are sent under their planning-region ids from FY2026 (FMR) and FY2025 (Income Limits), their " +
    "former county ids before.",
  "CHAS is a multi-year ACS tabulation (state, county, place); Picture of Subsidized Households " +
    "suppresses small cells, reported as unavailable rather than zero.",
  "hud_get_raw returns one endpoint's JSON unchanged (fmr, il, mtspil, chas, picture) for " +
    "fields the indicator tools do not surface.",
];

export function describeSource(): SourceDescription {
  return {
    agency: "hud",
    agencyName: "U.S. Department of Housing and Urban Development, HUD User",
    homepage: "https://www.huduser.gov",
    programs: PROGRAMS,
    quota:
      "HUD User API: a registered token is required (HUD_USER_TOKEN); 60 queries a minute per " +
      "token; responses cached (fiscal-year data is fixed once published)",
    caveats: CAVEATS,
    citationFormat:
      "U.S. Department of Housing and Urban Development, HUD User, <program> <fiscal year>. " +
      "Retrieved <date> from https://www.huduser.gov/hudapi/public.",
  };
}

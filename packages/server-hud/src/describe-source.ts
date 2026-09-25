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
 * instructions and, once indicator tools land, in every citation.
 */
export const HUD_USER_REQUIRED_SENTENCE =
  "This product uses the HUD User Data API but is not endorsed or certified by HUD User.";

/**
 * Backs the auto-registered `hud_describe_source` tool (M11, ADR-018 §1). This issue ships the
 * shell only — `hud_resolve_place` and `hud_describe_source` — so every program is `"planned"`;
 * later issues flip each to `"available"` as its indicator tool lands.
 */
const PROGRAMS: readonly ProgramDescription[] = [
  {
    code: "FMR",
    name: "Fair Market Rents",
    granularity:
      "county, metropolitan area, New England town; Small Area FMRs additionally by ZIP code",
    cadence: "annual (FY2017 on)",
    status: "planned",
  },
  {
    code: "IL",
    name: "Income Limits and Multifamily Tax Subsidy Project (MTSP) limits",
    granularity: "county, metropolitan area",
    cadence: "annual (FY2017 on)",
    status: "planned",
  },
  {
    code: "CHAS",
    name: "Comprehensive Housing Affordability Strategy (cost burden)",
    granularity: "state, county, place",
    cadence: "multi-year releases (2012–2016 through 2018–2022)",
    status: "planned",
  },
  {
    code: "PICTURE",
    name: "Picture of Subsidized Households",
    granularity: "county, place, tract, CBSA, state",
    cadence: "annual (2012–2025)",
    status: "planned",
  },
];

const CAVEATS: readonly string[] = [
  HUD_USER_REQUIRED_SENTENCE,
  "This release ships the shell only: hud_resolve_place and hud_describe_source. Every program " +
    "above is planned, not yet queryable — later issues add one indicator tool per program.",
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

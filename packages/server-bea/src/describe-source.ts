import type { ProgramDescription, SourceDescription } from "@federal-mcps/core";

/**
 * The BEA Data API base (ADR-019; docs/spikes/m14-bea-regional.md). Declared only here — the
 * contract's static check forbids agency hostnames outside a source declaration file, and every
 * upstream call builds off this constant through the core HTTP client, never a literal.
 */
export const BEA_API_ENDPOINT = "https://apps.bea.gov/api/data";

/**
 * The notice BEA's API Terms of Service ask every service to display prominently (read
 * 2026-09-28, ADR-019 §10). Reused verbatim in the instructions, describe_source and — once
 * indicator tools land — every citation (core `citationSuffix`).
 */
export const BEA_REQUIRED_SENTENCE =
  "This product uses the Bureau of Economic Analysis (BEA) Data API but is not endorsed or certified by BEA.";

/**
 * Backs the auto-registered `bea_describe_source` tool (M14, ADR-019 §2). The shell (#258)
 * lists the three programs as planned; #259–#261 flip each to available as its indicators land.
 */
const PROGRAMS: readonly ProgramDescription[] = [
  {
    code: "PI",
    name: "Personal income and per capita personal income",
    granularity: "county, state; state quarterly",
    cadence: "annual (county from 1969, state from 1929); state quarterly",
    status: "planned",
  },
  {
    code: "GDP",
    name: "Gross domestic product and real GDP, by industry",
    granularity: "county, state",
    cadence: "annual (from 2001 for counties)",
    status: "planned",
  },
  {
    code: "RPP",
    name: "Regional price parities",
    granularity: "metropolitan area, state",
    cadence: "annual (from 2008)",
    status: "planned",
  },
];

const CAVEATS: readonly string[] = [
  BEA_REQUIRED_SENTENCE,
  "BEA publishes Virginia's small independent cities combined with an adjacent county, and Kalawao " +
    "with Maui; a component answers with its combination, said in the caveats.",
  "Connecticut's county-level series are its nine planning regions from 2024; the eight former " +
    "counties end in 2023 and are not stitched onto them.",
  "Suppressed (D) and unavailable (NA) values are reported as unavailable, never as zero.",
  "This release ships the shell only: bea_resolve_place and bea_describe_source; the indicator " +
    "tools follow.",
];

export function describeSource(): SourceDescription {
  return {
    agency: "bea",
    agencyName: "U.S. Bureau of Economic Analysis",
    homepage: "https://www.bea.gov",
    programs: PROGRAMS,
    quota:
      "BEA Data API: a registered key is required (BEA_API_KEY); 100 requests, 100 MB and 30 " +
      "errors a minute per key; responses cached 7 days, each answer stating BEA's release note",
    caveats: CAVEATS,
    citationFormat:
      "U.S. Bureau of Economic Analysis, <table> <line>, <area>, <year>. Retrieved <date> from " +
      "https://apps.bea.gov/api/data.",
  };
}

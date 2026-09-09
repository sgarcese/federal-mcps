import type { ResourceDefinition } from "../server/definition.js";

/**
 * The geography guide (ADR-003 §9, ADR-008 §3): short, written for a model, so it asks for
 * the right geographic level before it asks for a number. Exposed as the `geography://guide`
 * MCP resource and reused verbatim by `describe_source`.
 */
export const GEOGRAPHY_GUIDE = `# U.S. geography for federal statistics

Resolve which KIND of place a question means before answering. Only
state → county → tract → block-group → block strictly nest. A city (Census
"place"), a metro area (CBSA), and the county a city sits in are three different
geographies that overlap but do not nest, and different programs publish at
different levels.

Denver is the worked example: the city of Denver (place 0820000), Denver County
(08031), and the Denver metro (CBSA 19740) share much territory but are not
interchangeable. Elsewhere, city and county boundaries diverge sharply. When a name
could mean several kinds, resolve_place returns status "ambiguous" — pick a kind.

Read the structured flags on each result rather than prose:
- below_threshold: a place under the LAUS 25,000 cutoff has no city-level unemployment
  series; use the surrounding county (flagged).
- non_nesting: a CBSA / CSA / ZCTA overlaps but does not nest.
- cdp: a census designated place is unincorporated — no local government, no LAUS series.
- consolidated_city: a consolidated city or its "balance" is not the county.
- vintage_mismatch: this area's code changed across years (e.g. Connecticut's 2022
  planning regions); joins across vintages may not line up.

Which level each program publishes at (Release 1, BLS):
- LAUS unemployment: state, county, metro, and incorporated cities >= 25,000.
- CES State & Area payroll employment: state, metro.
- QCEW employment & wages by industry: county, metro, state.
- OEWS occupational wages: state, metro.
- CPI: U.S. city average, regions/divisions, and ~23 named metros only — most places
  have no local CPI.
- JOLTS job openings: state only.

Two containment relations: "nests" is the hierarchy (a place allocated to its counties,
a county in its state); "overlaps" is areal (a ZCTA's tracts). A ZCTA is not a ZIP code —
PO-box and single-building ZIPs have no ZCTA. Every result carries a GEOID, a UCGID, and
a Data Commons DCID so a place can be carried across servers.`;

export const GEOGRAPHY_GUIDE_URI = "geography://guide";

/** The `geography://guide` resource definition, for a server's `resources` list. */
export function geographyGuideResource(): ResourceDefinition {
  return {
    uri: GEOGRAPHY_GUIDE_URI,
    name: "geography-guide",
    description:
      "How to reason about U.S. statistical geography: place kinds, non-nesting layers, the structured flags, and which program publishes at which level.",
    mimeType: "text/markdown",
    read: () => GEOGRAPHY_GUIDE,
  };
}

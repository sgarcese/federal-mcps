import type { GeographyCatalog, SourceDescription } from "@federal-mcps/core";

/**
 * Backs the auto-registered `geo_describe_source` tool. Reports the catalog vintage (read
 * from the bundled artifact) and what the geography server covers. Not a fetching source —
 * the catalog is a local file — so this names no external host.
 */
export function describeGeoSource(catalog: GeographyCatalog): SourceDescription {
  const vintage = catalog.vintage() ?? "unknown";
  return {
    agency: "geo",
    agencyName: "U.S. Census Bureau (geographic reference)",
    homepage: "https://www.census.gov/programs-surveys/geography.html",
    programs: [
      {
        code: "RESOLVE",
        name: "Place resolution",
        granularity: "state, county, place, metro, CSA, ZCTA, tract",
        cadence: "annual (catalog vintage)",
        status: "available",
      },
      {
        code: "CONTAINMENT",
        name: "Containment hierarchy",
        granularity: "place → county → CBSA → CSA → state, with allocation shares",
        cadence: "annual",
        status: "available",
      },
      {
        code: "OVERLAP",
        name: "Areal overlap (weighted)",
        granularity: "ZCTA ↔ tract, with allocation shares",
        cadence: "decennial",
        status: "available",
      },
      {
        code: "LINEAGE",
        name: "Tract lineage",
        granularity: "2010 → 2020 tract succession",
        cadence: "decennial",
        status: "available",
      },
    ],
    quota: `Local catalog, vintage ${vintage}; no external API and no rate limit.`,
    caveats: [
      "A place, its county, and its metro are different geographies; resolve_place returns 'ambiguous' when a name means several.",
      "ZCTA is not a ZIP code; PO-box and single-building ZIPs have no ZCTA.",
      "Read the structured flags (below_threshold, non_nesting, vintage_mismatch, cdp, consolidated_city) rather than prose.",
    ],
    citationFormat:
      "U.S. Census Bureau geographic reference files and OMB delineations, federal-mcps geography catalog (vintage <year>).",
  };
}

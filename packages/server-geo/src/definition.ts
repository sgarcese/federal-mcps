import {
  type GeographyCatalog,
  geographyGuideResource,
  geographyTools,
  type ServerDefinition,
} from "@federal-mcps/core";
import { describeGeoSource } from "./describe-source.js";
import { GEO_SERVER_VERSION } from "./version.js";

const INSTRUCTIONS = `
This server resolves U.S. geography for federal statistics and reports how places relate.
Resolve which KIND of place a question means before answering: a city, its county, and its
metro area are different geographies that overlap but do not nest, and geo_resolve_place
returns status "ambiguous" when a name could mean several — pick one with the \`kind\`
argument — or when the same kind of place shares a name across states with none dominant
(Springfield, Portland) — pick one with \`state\`, or write "Springfield, MO". Read the structured flags on each result (below_threshold, non_nesting,
vintage_mismatch, cdp, consolidated_city) rather than prose. get_containment gives the
hierarchy (a place's counties, its state, with shares); get_overlap gives areal overlap
(a ZCTA's tracts with shares); get_lineage maps a 2010 tract to its 2020 successors;
list_availability says which programs publish at a place's level. See the geography://guide
resource for the full model. Every result carries a GEOID, a UCGID, and a Data Commons DCID.
`.trim();

/** The geography server definition, built on the shared resolver tools and the guide. */
export function buildGeoDefinition(catalog: GeographyCatalog): ServerDefinition {
  return {
    name: "federal-mcps-geo",
    version: GEO_SERVER_VERSION,
    agency: "geo",
    instructions: INSTRUCTIONS,
    tools: geographyTools({
      agency: "geo",
      catalog: () => catalog,
      include: [
        "resolve_place",
        "get_containment",
        "get_overlap",
        "get_lineage",
        "list_availability",
      ],
    }),
    resources: [geographyGuideResource()],
    describeSource: () => describeGeoSource(catalog),
  };
}

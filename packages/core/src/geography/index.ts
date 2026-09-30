/**
 * The shared geography resolver (ADR-003 as amended, ADR-008). One resolver over the
 * versioned SQLite catalog serves every server in the family: place-name resolution with
 * ambiguity-stops and structured flags, containment, overlap and lineage.
 */

export { openBundledCatalog, setCatalogForTest } from "./bundled-catalog.js";
export { type EntityRecord, GeographyCatalog } from "./catalog.js";
export { deriveFlags, type EntityFacts } from "./flags.js";
export { GEOGRAPHY_GUIDE, GEOGRAPHY_GUIDE_URI, geographyGuideResource } from "./guide.js";
export { dcidOf, ucgidOf } from "./identifiers.js";
export {
  getAvailability,
  getContainment,
  getLineage,
  getOverlap,
  resolvePlace,
  uspsOfStateFips,
} from "./resolver.js";
export { type GeographyToolName, type GeographyToolsOptions, geographyTools } from "./tools.js";
export * from "./types.js";

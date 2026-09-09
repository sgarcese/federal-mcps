/**
 * The shared geography resolver (ADR-003 as amended, ADR-008). One resolver over the
 * versioned SQLite catalog serves every server in the family: place-name resolution with
 * ambiguity-stops and structured flags, containment, overlap and lineage.
 */
export { GeographyCatalog, type EntityRecord } from "./catalog.js";
export { deriveFlags, type EntityFacts } from "./flags.js";
export {
  getAvailability,
  getContainment,
  getLineage,
  getOverlap,
  resolvePlace,
} from "./resolver.js";
export * from "./types.js";
export { geographyTools, type GeographyToolsOptions, type GeographyToolName } from "./tools.js";
export { GEOGRAPHY_GUIDE, GEOGRAPHY_GUIDE_URI, geographyGuideResource } from "./guide.js";

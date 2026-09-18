/**
 * @federal-mcps/geography-build — builds the versioned SQLite geography catalog
 * (`@rc/geo-catalog`) from Census, OMB and BLS sources (ADR-003, ADR-008).
 *
 * The build is `npm run geography:build` (network, via `src/cli/build.ts`). This entry
 * point exports the pure, testable pieces the resolver package (#56) and #55 build on.
 */
export { assemble, type Sources } from "./assemble.js";
export { buildCatalog, catalogMeta, openCatalog, type BuildOptions } from "./catalog.js";
export { createSchema, SCHEMA_VERSION } from "./schema.js";
export {
  decodeLausAreaCode,
  parseCesArea,
  parseCpiArea,
  parseLausArea,
  parseOewsArea,
  parseQcewArea,
} from "./parse/bls-area.js";
export { parseGazetteer, stripLsad } from "./parse/gazetteer.js";
export { parseGeocorr } from "./parse/geocorr.js";
export {
  parseCdCounty,
  parseCdPlace,
  parsePlaceCounty,
  parseTractLineage,
  parseZctaCounty,
  parseZctaPlace,
  parseZctaTract,
} from "./parse/relationship.js";
export { COUNTY_CHANGES, CPI_AREA_TO_CBSA, PUBLISHES_AT } from "./data/static.js";
export type * from "./types.js";

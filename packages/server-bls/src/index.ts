/**
 * @federal-mcps/server-bls — Bureau of Labor Statistics server (issue #8).
 *
 * `createBlsServer` builds the family shell's `McpServer` from this
 * package's `definition` (`packages/core/src/server/create-server.ts`); a
 * caller then runs it over stdio (`src/stdio.ts`, the `federal-mcps-bls` bin)
 * or Streamable HTTP (`src/http.ts`).
 */
import { type CreateServerOptions, createServer, openBundledCatalog } from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildBlsDefinition } from "./definition.js";

export { buildBlsDefinition } from "./definition.js";
export { describeSource } from "./describe-source.js";
export { openBundledCatalog, setCatalogForTest } from "@federal-mcps/core";
export { BLS_SERVER_VERSION } from "./version.js";
export {
  buildLausSeriesId,
  isLausSeriesId,
  LAUS_MEASURE_CODES,
  LAUS_MEASURES,
  type LausMeasure,
  type LausSeriesOptions,
} from "./laus.js";

/** Builds the configured BLS `McpServer` over the bundled catalog, ready to run. */
export function createBlsServer(options?: CreateServerOptions): McpServer {
  return createServer(buildBlsDefinition(openBundledCatalog()), options);
}

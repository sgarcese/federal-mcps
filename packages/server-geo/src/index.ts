/**
 * @federal-mcps/server-geo — the hosted geography MCP server (#58). The family's first
 * non-BLS server: it consumes the shared resolver tools (geographyTools) and the geography
 * guide, proving the core generalises. Runs over stdio (the `federal-mcps-geo` bin) or
 * Streamable HTTP (`src/http.ts`, and the Lambda in `src/lambda.ts`).
 */
import { createServer, type CreateServerOptions, openBundledCatalog } from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildGeoDefinition } from "./definition.js";

export { buildGeoDefinition } from "./definition.js";
export { describeGeoSource } from "./describe-source.js";
export { openBundledCatalog, setCatalogForTest } from "@federal-mcps/core";
export { GEO_SERVER_VERSION } from "./version.js";

/** Builds the configured geography `McpServer` over the bundled catalog. */
export function createGeoServer(options?: CreateServerOptions): McpServer {
  return createServer(buildGeoDefinition(openBundledCatalog()), options);
}

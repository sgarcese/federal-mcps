/** The Node HTTP handler for the geography server (#58), mirroring server-bls/http.ts. */
import { createHttpHandler, type NodeHttpHandler } from "@federal-mcps/core";
import { createGeoServer } from "./index.js";

/** The path the deployed server answers on (ADR-008 §1: `geo-mcp.responsive.city/mcp`). */
export const MCP_PATH = "/mcp";

/** Builds the geography server's stateless Streamable HTTP handler, mounted at `MCP_PATH`. */
export function createGeoHttpHandler(): NodeHttpHandler {
  return createHttpHandler(createGeoServer(), { path: MCP_PATH });
}

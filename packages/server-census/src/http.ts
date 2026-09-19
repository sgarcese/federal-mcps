/**
 * The Node HTTP handler for the Census server (M8.1, on the shell's
 * `createHttpHandler` from #6): a bare `(req, res)` function, reused by a
 * local dev server (`src/http-dev.ts`, `npm run dev:http`) and, in issue #9,
 * a Lambda adapter.
 */
import { createHttpHandler, type NodeHttpHandler } from "@federal-mcps/core";
import { createCensusServer } from "./index.js";

/** The path the deployed server answers on (ADR-004 §5: `census-mcp.responsive.city/mcp`). */
export const MCP_PATH = "/mcp";

/** Builds the Census server's stateless Streamable HTTP handler, mounted at `MCP_PATH`. */
export function createCensusHttpHandler(): NodeHttpHandler {
  return createHttpHandler(createCensusServer(), { path: MCP_PATH });
}

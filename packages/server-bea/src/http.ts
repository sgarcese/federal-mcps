/**
 * The Node HTTP handler for the BEA server (M14): a bare `(req, res)`
 * function, reused by a local dev server (`src/http-dev.ts`, `npm run dev:http`) and
 * the Lambda adapter (`src/lambda.ts`).
 */
import { createHttpHandler, type NodeHttpHandler } from "@federal-mcps/core";
import { createBeaServer } from "./index.js";

/** The path the deployed server answers on (ADR-004 §5: `bea.responsive.city/mcp`). */
export const MCP_PATH = "/mcp";

/** Builds the BEA server's stateless Streamable HTTP handler, mounted at `MCP_PATH`. */
export function createBeaHttpHandler(): NodeHttpHandler {
  return createHttpHandler(createBeaServer(), { path: MCP_PATH });
}

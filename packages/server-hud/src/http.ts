/**
 * The Node HTTP handler for the HUD User server (M11, shell): a bare `(req, res)`
 * function, reused by a local dev server (`src/http-dev.ts`, `npm run dev:http`) and
 * the Lambda adapter (`src/lambda.ts`).
 */
import { createHttpHandler, type NodeHttpHandler } from "@federal-mcps/core";
import { createHudServer } from "./index.js";

/** The path the deployed server answers on (ADR-004 §5: `huduser.responsive.city/mcp`). */
export const MCP_PATH = "/mcp";

/** Builds the HUD User server's stateless Streamable HTTP handler, mounted at `MCP_PATH`. */
export function createHudHttpHandler(): NodeHttpHandler {
  return createHttpHandler(createHudServer(), { path: MCP_PATH });
}

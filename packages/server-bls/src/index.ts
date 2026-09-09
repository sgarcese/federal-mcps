/**
 * @federal-mcps/server-bls — Bureau of Labor Statistics server (issue #8).
 *
 * `createBlsServer` builds the family shell's `McpServer` from this
 * package's `definition` (`packages/core/src/server/create-server.ts`); a
 * caller then runs it over stdio (`src/stdio.ts`, the `federal-mcps-bls` bin)
 * or Streamable HTTP (`src/http.ts`).
 */
import { type CreateServerOptions, createServer } from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { definition } from "./definition.js";

export { definition } from "./definition.js";
export { describeSource } from "./describe-source.js";
export { BLS_SERVER_VERSION } from "./version.js";

/** Builds the configured BLS `McpServer`, ready for `runStdio` or `createHttpHandler`. */
export function createBlsServer(options?: CreateServerOptions): McpServer {
  return createServer(definition, options);
}

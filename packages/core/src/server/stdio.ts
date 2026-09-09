import type { Readable, Writable } from "node:stream";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * The local transport (#6): stdio, for hosts that launch the server as a child
 * process (Claude Desktop, Claude Code, most MCP clients' local mode).
 *
 * **stdout is the transport.** Anything an agency package prints to stdout —
 * a `console.log`, a stray library banner — corrupts the JSON-RPC stream and
 * the host sees a parse error, not a message. Diagnostics go to stderr.
 */

export interface StdioOptions {
  /** Input stream; defaults to the process's stdin. Injectable for tests. */
  readonly stdin?: Readable;
  /** Output stream; defaults to the process's stdout. Injectable for tests. */
  readonly stdout?: Writable;
}

/**
 * Connects `server` to a stdio transport and resolves once it is listening.
 * The process then stays alive on the stdin stream until the host closes it,
 * so a `bin` script's last statement is normally `await runStdio(...)`.
 *
 * Returns the transport so a caller (or a test) can close it deliberately.
 */
export async function runStdio(
  server: McpServer,
  options?: StdioOptions,
): Promise<StdioServerTransport> {
  const transport = new StdioServerTransport(options?.stdin, options?.stdout);
  // See http.ts: the SDK's transports type their callbacks as accepting
  // `undefined`, which `exactOptionalPropertyTypes` will not match against
  // `Transport`'s optional properties. The runtime shape is identical.
  await server.connect(transport as Transport);
  return transport;
}

/**
 * Local HTTP dev server: `npm run dev:http -w packages/server-hud`.
 *
 * Serves `createHudHttpHandler()` on plain `node:http` so the Streamable HTTP
 * transport can be exercised the same way ADR-004's Lambda deployment will
 * serve it, without any AWS dependency. Diagnostics go to stderr — see
 * `src/stdio.ts` for why stdout is off-limits elsewhere in this package; here
 * it merely keeps the two entry points symmetric.
 */
import { createServer as createNodeHttpServer } from "node:http";
import { createHudHttpHandler, MCP_PATH } from "./http.js";

const DEFAULT_PORT = 3004;
// biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under noPropertyAccessFromIndexSignature.
const port = Number(process.env["MCP_HTTP_PORT"] ?? DEFAULT_PORT);

const handler = createHudHttpHandler();
const server = createNodeHttpServer((req, res) => {
  void handler(req, res);
});

server.listen(port, () => {
  process.stderr.write(`federal-mcps-hud listening on http://localhost:${port}${MCP_PATH}\n`);
});

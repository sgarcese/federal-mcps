/**
 * Local HTTP dev server: `GEO_CATALOG_PATH=... npm run dev:http -w packages/server-geo`.
 * Serves the geography handler on plain node:http, no AWS dependency.
 */
import { createServer as createNodeHttpServer } from "node:http";
import { createGeoHttpHandler, MCP_PATH } from "./http.js";

const DEFAULT_PORT = 3001;
// biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under noPropertyAccessFromIndexSignature.
const port = Number(process.env["MCP_HTTP_PORT"] ?? DEFAULT_PORT);

const handler = createGeoHttpHandler();
const server = createNodeHttpServer((req, res) => {
  void handler(req, res);
});
server.listen(port, () => {
  process.stderr.write(`geo MCP server on http://localhost:${port}${MCP_PATH}\n`);
});

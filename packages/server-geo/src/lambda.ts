/**
 * Lambda adapter for the geography MCP server (#58): API Gateway v2 (HTTP API,
 * payload format 2.0) in, `createHttpHandler`'s plain Node `(req, res)` handler
 * (packages/core/src/server/http.ts) underneath.
 *
 * Same technique as server-bls's adapter (see its lambda.ts for the full rationale):
 * the SDK's Streamable HTTP transport drives a *real* IncomingMessage/ServerResponse
 * through @hono/node-server, so rather than fake a socket, this runs the real handler
 * behind a real loopback HTTP server started once per container and turns each
 * invocation into one http.request against it. No new runtime dependency: node:http.
 *
 * Unlike bls, this server reads its data — the bundled geography catalog — at cold
 * start via GEO_CATALOG_PATH (Terraform sets it to the catalog's path inside the zip,
 * ADR-008 §7). `createGeoServer()` opens the catalog eagerly, so a missing or wrong
 * path fails loudly at container init rather than on the first tool call. This adapter
 * only adds a clearer warning first.
 */
import { createServer as createNodeServer, request as httpRequest, type Server } from "node:http";
import { createHttpHandler } from "@federal-mcps/core";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createGeoServer } from "./index.js";

// biome-ignore lint/complexity/useLiteralKeys: tsconfig's noPropertyAccessFromIndexSignature requires bracket access here.
if (!process.env["GEO_CATALOG_PATH"]) {
  console.warn("GEO_CATALOG_PATH is not set; the geography catalog cannot be opened.");
}

// Built once per container: one McpServer (with the catalog open), one loopback Node
// HTTP server wrapping it, reused across invocations.
const nodeHandler = createHttpHandler(createGeoServer(), { path: "/mcp" });
let localServer: Server | undefined;
let readyPort: Promise<number> | undefined;

function ensureLocalServer(): Promise<number> {
  if (readyPort) return readyPort;
  localServer = createNodeServer((req, res) => {
    void nodeHandler(req, res);
  });
  readyPort = new Promise((resolve, reject) => {
    localServer?.once("error", reject);
    localServer?.listen(0, "127.0.0.1", () => {
      const address = localServer?.address();
      if (address === null || typeof address !== "object" || address === undefined) {
        reject(new Error("loopback server did not return a port"));
        return;
      }
      resolve(address.port);
    });
  });
  return readyPort;
}

function requestPath(event: APIGatewayProxyEventV2): string {
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  return `${event.rawPath}${query}`;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const port = await ensureLocalServer();
  const body = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf-8")
    : undefined;

  return new Promise((resolve, reject) => {
    const clientRequest = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: requestPath(event),
        method: event.requestContext.http.method,
        headers: event.headers as Record<string, string>,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(", ") : value;
          }
          resolve({
            statusCode: response.statusCode ?? 500,
            headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
        response.on("error", reject);
      },
    );
    clientRequest.on("error", reject);
    if (body) clientRequest.write(body);
    clientRequest.end();
  });
}

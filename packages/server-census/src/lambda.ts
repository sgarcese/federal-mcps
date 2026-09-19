/**
 * Lambda adapter for the Census MCP server (M8.1): API Gateway v2 (HTTP API,
 * payload format 2.0) in, `createHttpHandler`'s plain Node `(req, res)`
 * handler (packages/core/src/server/http.ts) underneath.
 *
 * The SDK's Streamable HTTP transport converts req/res to/from a Web
 * Standard Request/Response through `@hono/node-server`, which drives a
 * *real* `IncomingMessage`/`ServerResponse` pair (it reads `req.rawHeaders`,
 * consumes the body via `req.on('data'/'end')`, and calls
 * `res.writeHead`/`res.write`/`res.end`). Rather than hand-build a fake
 * socket that satisfies every internal it touches, this adapter runs the
 * real handler behind a real loopback HTTP server started once per
 * container, and turns each Lambda invocation into one `http.request`
 * against that server — the same technique `aws-serverless-express` used.
 * No new runtime dependency: only `node:http`.
 *
 * `CENSUS_API_KEY` is not read here — it is exposed to the process
 * environment by Terraform (terraform/modules/census-server) and will be read
 * lazily by the ACS fetch capability (M8.2). This adapter only
 * warns at cold start if it is missing, so a misconfigured deployment fails
 * loudly rather than on first tool call.
 */
import { createServer as createNodeServer, request as httpRequest, type Server } from "node:http";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createHttpHandler } from "@federal-mcps/core";
import { createCensusServer } from "./index.js";

// biome-ignore lint/complexity/useLiteralKeys: tsconfig's noPropertyAccessFromIndexSignature requires bracket access here.
if (!process.env["CENSUS_API_KEY"]) {
  console.warn(
    "CENSUS_API_KEY is not set; every Census Data API query will fail (a key is mandatory).",
  );
}

// Built once per container: one McpServer, one loopback Node HTTP server
// wrapping it, reused across invocations.
const nodeHandler = createHttpHandler(createCensusServer(), { path: "/mcp" });
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

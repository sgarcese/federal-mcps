import { rmSync } from "node:fs";
import { dirname } from "node:path";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";

const MCP_ACCEPT = "application/json, text/event-stream";

/** A recorded-shape API Gateway v2 (HTTP API) event, trimmed to what the adapter reads. */
function event(overrides: Partial<APIGatewayProxyEventV2>): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /mcp",
    rawPath: "/mcp",
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api",
      domainName: "bls-mcp.responsive.city",
      domainPrefix: "bls-mcp",
      http: {
        method: "POST",
        path: "/mcp",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "test-request-id",
      routeKey: "POST /mcp",
      stage: "$default",
      time: "08/Sep/2026:00:00:00 +0000",
      timeEpoch: 0,
    },
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

function rpcEvent(method: string, params: Record<string, unknown> = {}): APIGatewayProxyEventV2 {
  return event({
    headers: { "content-type": "application/json", accept: MCP_ACCEPT },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

const INITIALIZE_PARAMS = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "vitest", version: "0.0.0" },
};

// The adapter opens the catalog at import (createBlsServer runs at module top level),
// so GEO_CATALOG_PATH must be set to a real fixture *before* the module is imported.
let catalogPath: string;
let handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

beforeAll(async () => {
  catalogPath = buildFixtureCatalog();
  process.env.GEO_CATALOG_PATH = catalogPath;
  ({ handler } = await import("./lambda.js"));
});
afterAll(() => {
  delete process.env.GEO_CATALOG_PATH;
  rmSync(dirname(catalogPath), { recursive: true, force: true });
});

describe("bls lambda handler", () => {
  it("answers initialize with 200 and the bls server name", async () => {
    const result = await handler(rpcEvent("initialize", INITIALIZE_PARAMS));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse((result.body as string) ?? "{}");
    expect(body.result.serverInfo.name).toBe("federal-mcps-bls");
  });

  it("lists bls_resolve_place and bls_describe_source on tools/list", async () => {
    await handler(rpcEvent("initialize", INITIALIZE_PARAMS));
    const result = await handler(rpcEvent("tools/list"));
    const body = JSON.parse((result.body as string) ?? "{}");
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("bls_resolve_place");
    expect(names).toContain("bls_describe_source");
  });

  it("returns 405 with an Allow: POST header for GET /mcp", async () => {
    const result = await handler(
      event({
        routeKey: "GET /mcp",
        headers: { accept: MCP_ACCEPT },
        requestContext: {
          accountId: "123456789012",
          apiId: "test-api",
          domainName: "bls-mcp.responsive.city",
          domainPrefix: "bls-mcp",
          http: {
            method: "GET",
            path: "/mcp",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "vitest",
          },
          requestId: "test-request-id-2",
          routeKey: "GET /mcp",
          stage: "$default",
          time: "08/Sep/2026:00:00:00 +0000",
          timeEpoch: 0,
        },
      }),
    );
    expect(result.statusCode).toBe(405);
    expect(result.headers?.allow).toBe("POST");
  });
});

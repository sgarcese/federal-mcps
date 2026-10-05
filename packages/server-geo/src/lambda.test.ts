import { rmSync } from "node:fs";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";
import { SOURCE_IP_HEADER } from "@federal-mcps/core";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";

// Records the headers the loopback server receives, so the tests below can show what the adapter
// forwards (#321). The wrapper delegates to the real handler; nothing else changes.
const loopback = vi.hoisted(() => ({ headers: [] as IncomingHttpHeaders[] }));
vi.mock("@federal-mcps/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@federal-mcps/core")>();
  return {
    ...core,
    createHttpHandler: (...args: Parameters<typeof core.createHttpHandler>) => {
      const inner = core.createHttpHandler(...args);
      return (req: IncomingMessage, res: ServerResponse) => {
        loopback.headers.push(req.headers);
        return inner(req, res);
      };
    },
  };
});

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
      domainName: "geo-mcp.responsive.city",
      domainPrefix: "geo-mcp",
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
      time: "09/Sep/2026:00:00:00 +0000",
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

// The adapter opens the catalog at import (createGeoServer runs at module top level),
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

describe("geo lambda handler", () => {
  it("answers initialize with 200 and the geo server name", async () => {
    const result = await handler(rpcEvent("initialize", INITIALIZE_PARAMS));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse((result.body as string) ?? "{}");
    expect(body.result.serverInfo.name).toBe("federal-mcps-geo");
  });

  it("lists the geo tools on tools/list", async () => {
    await handler(rpcEvent("initialize", INITIALIZE_PARAMS));
    const result = await handler(rpcEvent("tools/list"));
    const body = JSON.parse((result.body as string) ?? "{}");
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("geo_resolve_place");
    expect(names).toContain("geo_describe_source");
  });

  it("returns 405 with an Allow: POST header for GET /mcp", async () => {
    const result = await handler(
      event({
        routeKey: "GET /mcp",
        headers: { accept: MCP_ACCEPT },
        requestContext: {
          accountId: "123456789012",
          apiId: "test-api",
          domainName: "geo-mcp.responsive.city",
          domainPrefix: "geo-mcp",
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
          time: "09/Sep/2026:00:00:00 +0000",
          timeEpoch: 0,
        },
      }),
    );
    expect(result.statusCode).toBe(405);
    expect(result.headers?.allow).toBe("POST");
  });
});

describe("lambda adapter: caller identity headers (#321)", () => {
  it("forwards requestContext's source address, replacing a client-sent copy", async () => {
    const spoofed = rpcEvent("initialize", INITIALIZE_PARAMS);
    spoofed.headers = {
      ...spoofed.headers,
      "X-Federal-MCPS-Source-IP": "160.79.104.1",
      "x-forwarded-for": "160.79.104.2",
    };
    spoofed.requestContext.http.sourceIp = "198.51.100.7";
    const result = await handler(spoofed);
    expect(result.statusCode).toBe(200);
    expect(loopback.headers.at(-1)?.[SOURCE_IP_HEADER]).toBe("198.51.100.7");
  });
});

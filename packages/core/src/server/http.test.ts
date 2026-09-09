import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvelopeSchema } from "../envelope/index.js";
import { createServer } from "./create-server.js";
import { createHttpHandler } from "./http.js";
import { demoDefinition } from "./__fixtures__/demo-definition.js";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const MCP_ACCEPT = "application/json, text/event-stream";

let httpServer: Server;
let baseUrl: string;

function listen(handler: Parameters<typeof createHttpServer>[0]): Promise<void> {
  httpServer = createHttpServer(handler);
  return new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  path = "/mcp",
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: MCP_ACCEPT },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

/** Streamable HTTP requires an `initialize` before anything else on a connection. */
const INITIALIZE_PARAMS = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-client", version: "0.0.0" },
};

beforeEach(async () => {
  await listen(createHttpHandler(createServer(demoDefinition, { now: () => NOW })));
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("createHttpHandler", () => {
  it("answers initialize with JSON (no SSE, no session id) naming the server", async () => {
    const response = await rpc("initialize", INITIALIZE_PARAMS);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = await response.json();
    expect(body.result.serverInfo.name).toBe(demoDefinition.name);
    expect(body.result.instructions).toBe(demoDefinition.instructions);
  });

  it("lists every tool with the family annotations, including describe_source", async () => {
    await rpc("initialize", INITIALIZE_PARAMS);
    const body = await (await rpc("tools/list")).json();
    const names = body.result.tools.map((tool: { name: string }) => tool.name).sort();
    expect(names).toEqual(["demo_describe_source", "demo_get_indicator", "demo_get_raw"]);
    for (const tool of body.result.tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
  });

  it("returns an envelope in structuredContent from tools/call", async () => {
    await rpc("initialize", INITIALIZE_PARAMS);
    const body = await (
      await rpc("tools/call", { name: "demo_get_raw", arguments: { text: "hi" } })
    ).json();
    const env = EnvelopeSchema.parse(body.result.structuredContent);
    expect(env.data).toEqual({ text: "hi" });
    expect(env.source.agency).toBe("demo");
  });

  it("rejects GET and DELETE with 405 and an Allow header", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(`${baseUrl}/mcp`, { method, headers: { accept: MCP_ACCEPT } });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("accepts any path by default", async () => {
    const response = await rpc("initialize", INITIALIZE_PARAMS, "/anything");
    expect(response.status).toBe(200);
  });
});

describe("createHttpHandler with a fixed path", () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await listen(
      createHttpHandler(createServer(demoDefinition, { now: () => NOW }), { path: "/mcp" }),
    );
  });

  it("serves the configured path and 404s everything else", async () => {
    expect((await rpc("initialize", INITIALIZE_PARAMS, "/mcp")).status).toBe(200);
    expect((await rpc("initialize", INITIALIZE_PARAMS, "/other")).status).toBe(404);
  });
});

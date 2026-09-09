import { createServer as createNodeHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EnvelopeSchema } from "@federal-mcps/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBlsHttpHandler, MCP_PATH } from "./http.js";

const MCP_ACCEPT = "application/json, text/event-stream";
const INITIALIZE_PARAMS = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-client", version: "0.0.0" },
};

let httpServer: Server;
let baseUrl: string;

function rpc(
  method: string,
  params: Record<string, unknown> = {},
  path = MCP_PATH,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: MCP_ACCEPT },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

beforeEach(async () => {
  httpServer = createNodeHttpServer((req, res) => {
    void createBlsHttpHandler()(req, res);
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("createBlsHttpHandler", () => {
  it("serves the BLS server at /mcp and answers initialize", async () => {
    const response = await rpc("initialize", INITIALIZE_PARAMS);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.serverInfo.name).toBe("federal-mcps-bls");
  });

  it("404s any other path", async () => {
    const response = await rpc("initialize", INITIALIZE_PARAMS, "/other");
    expect(response.status).toBe(404);
  });

  it("lists bls_describe_source and answers it with an envelope", async () => {
    await rpc("initialize", INITIALIZE_PARAMS);
    const list = await (await rpc("tools/list")).json();
    const names = list.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(["bls_describe_source"]);

    const call = await (
      await rpc("tools/call", { name: "bls_describe_source", arguments: {} })
    ).json();
    const env = EnvelopeSchema.parse(call.result.structuredContent);
    expect(env.source.agency).toBe("bls");
  });
});

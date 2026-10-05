import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildCitation } from "../envelope/index.js";
import { MemoryCounterStore } from "../limits/counter-store.js";
import { LimitExceededError, type Limiter } from "../limits/limiter.js";
import { createLimiter } from "../limits/persistent-limiter.js";
import type { Caller } from "./caller.js";
import { type CreateServerOptions, createServer } from "./create-server.js";
import type { ServerDefinition, ToolDefinition } from "./definition.js";
import { createHttpHandler } from "./http.js";
import { lambdaRequestHeaders } from "./lambda-headers.js";

/**
 * The shell counts each tool call against the caller's share before the handler runs (#322,
 * ADR-020 §2): a refusal propagates as the call's error, and the handler never runs.
 */

const NOW = new Date("2026-10-05T12:00:00.000Z");
const MCP_ACCEPT = "application/json, text/event-stream";
const CALLER: Caller = { kind: "network", key: "k".repeat(32), labels: {}, bypass: false };

const input = z.object({});
const handler = vi.fn(async (_input: unknown, context: { now: () => Date }) => {
  const parts = { agency: "demo", program: "Demo", ids: [], url: "https://example.invalid" };
  return {
    data: { ok: true },
    source: { ...parts, citation: buildCitation(parts, context.now()) },
  };
});
const tool: ToolDefinition<typeof input, { ok: boolean }> = {
  name: "demo_get_raw",
  title: "Demo",
  description: "Answers ok.",
  input,
  examples: [{ title: "ok", input: {} }],
  handler,
};

const definition: ServerDefinition = {
  name: "federal-mcps-demo",
  version: "0.0.0",
  agency: "demo",
  instructions: "Demo.",
  tools: [tool],
  describeSource: () => ({
    agency: "demo",
    agencyName: "Demo Agency",
    homepage: "https://example.invalid",
    programs: [],
    quota: "none",
    caveats: [],
    citationFormat: "Demo",
  }),
};

let closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
  handler.mockClear();
});

/** Calls the tool `times` times over HTTP, through the adapter's attested headers. */
async function callOverHttp(options: CreateServerOptions, times: number) {
  const httpServer: Server = createHttpServer(
    createHttpHandler(createServer(definition, options), { path: "/mcp" }),
  );
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => httpServer.close(() => resolve())));
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
  const headers = lambdaRequestHeaders({
    headers: {},
    requestContext: { http: { sourceIp: "198.51.100.7" } },
  });
  const post = (method: string, params: Record<string, unknown>) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: MCP_ACCEPT, ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  await post("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  });
  const results: Array<{ isError?: boolean; content: Array<{ text: string }> }> = [];
  for (let i = 0; i < times; i++) {
    const body = await (await post("tools/call", { name: "demo_get_raw", arguments: {} })).json();
    results.push(body.result);
  }
  return results;
}

describe("createServer: the limiter's tool-call share", () => {
  it("asks the limiter with the call's caller and the clock, before the handler", async () => {
    const order: string[] = [];
    const limiter: Limiter = {
      beginToolCall: vi.fn(async () => {
        order.push("limiter");
      }),
      beforeUpstream: async () => undefined,
      usage: async () => undefined,
    };
    handler.mockImplementationOnce(async (_input, context) => {
      order.push("handler");
      const parts = { agency: "demo", program: "Demo", ids: [], url: "https://example.invalid" };
      return {
        data: { ok: true },
        source: { ...parts, citation: buildCitation(parts, context.now()) },
      };
    });
    await callOverHttp({ now: () => NOW, identify: () => CALLER, limiter }, 1);
    expect(limiter.beginToolCall).toHaveBeenCalledWith(CALLER, NOW);
    expect(order).toEqual(["limiter", "handler"]);
  });

  it("refuses a call past its share: the error propagates and the handler never runs", async () => {
    const limiter: Limiter = {
      beginToolCall: async () => {
        throw new LimitExceededError({
          scope: "network",
          kind: "toolCalls",
          limit: 2,
          used: 2,
          resetsAt: "2026-10-06T00:00:00.000Z",
        });
      },
      beforeUpstream: async () => undefined,
      usage: async () => undefined,
    };
    const [result] = await callOverHttp({ now: () => NOW, identify: () => CALLER, limiter }, 1);
    expect(result?.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it("end to end: an in-memory limiter refuses the 3rd call when toolCallsDaily is 2", async () => {
    const limiter = createLimiter({
      config: { network: { toolCallsDaily: 2 } },
      store: new MemoryCounterStore(),
    });
    const results = await callOverHttp({ now: () => NOW, identify: () => CALLER, limiter }, 3);
    expect(results.map((r) => r.isError === true)).toEqual([false, false, true]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("asks with no caller over stdio, so no share applies", async () => {
    const limiter = createLimiter({
      config: { network: { toolCallsDaily: 1 } },
      store: new MemoryCounterStore(),
    });
    const server = createServer(definition, { now: () => NOW, limiter });
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    closers.push(async () => {
      await client.close();
      await server.close();
    });
    for (let i = 0; i < 3; i++) {
      const result = await client.callTool({ name: "demo_get_raw", arguments: {} });
      expect(result.isError).not.toBe(true);
    }
  });
});

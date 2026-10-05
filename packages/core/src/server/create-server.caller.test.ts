import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildCitation } from "../envelope/index.js";
import type { Caller, Identify, RequestHeaders } from "./caller.js";
import { OPERATOR_BYPASS_HEADER, SOURCE_IP_HEADER } from "./caller.js";
import { createServer, type CreateServerOptions } from "./create-server.js";
import type { ServerDefinition, ToolDefinition } from "./definition.js";
import { createHttpHandler } from "./http.js";
import { CALLER_SECRET_ENV, OPERATOR_TOKEN_ENV } from "./identify.js";

/**
 * The shell builds `ToolContext.caller` from the HTTP request's headers (#321, ADR-020 §1):
 * a tool handler sees the caller over Streamable HTTP and sees none over stdio.
 */

const NOW = new Date("2026-10-05T12:00:00.000Z");
const MCP_ACCEPT = "application/json, text/event-stream";

const whoamiInput = z.object({});
const whoami: ToolDefinition<typeof whoamiInput, { caller: Caller | null }> = {
  name: "demo_get_raw",
  title: "Who am I",
  description: "Returns the caller the shell built.",
  input: whoamiInput,
  examples: [{ title: "who", input: {} }],
  handler: async (_input, context) => {
    const parts = { agency: "demo", program: "Who", ids: [], url: "https://example.invalid" };
    return {
      data: { caller: context.caller ?? null },
      source: { ...parts, citation: buildCitation(parts, context.now()) },
    };
  },
};

const definition: ServerDefinition = {
  name: "federal-mcps-demo",
  version: "0.0.0",
  agency: "demo",
  instructions: "Demo.",
  tools: [whoami],
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

const FAKE_CALLER: Caller = { kind: "network", key: "k".repeat(32), labels: {}, bypass: false };

let closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers) await close();
  closers = [];
  vi.unstubAllEnvs();
});

async function overHttp(
  options: CreateServerOptions,
  headers: Record<string, string>,
): Promise<Caller | null> {
  const httpServer: Server = createHttpServer(
    createHttpHandler(createServer(definition, options), { path: "/mcp" }),
  );
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => httpServer.close(() => resolve())));
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
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
  const body = await (await post("tools/call", { name: "demo_get_raw", arguments: {} })).json();
  return body.result.structuredContent.data.caller;
}

async function overInMemory(options: CreateServerOptions): Promise<Caller | null> {
  const server = createServer(definition, options);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({ name: "demo_get_raw", arguments: {} });
  return (result.structuredContent as { data: { caller: Caller | null } }).data.caller;
}

describe("createServer: caller identity", () => {
  it("hands the handler the caller identify() builds from the HTTP request headers", async () => {
    const seen: Array<{ headers: RequestHeaders; now: Date }> = [];
    const identify: Identify = (headers, now) => {
      seen.push({ headers, now });
      return FAKE_CALLER;
    };
    const caller = await overHttp(
      { now: () => NOW, identify },
      { [SOURCE_IP_HEADER]: "198.51.100.7", "User-Agent": "claude-code/2.0" },
    );
    expect(caller).toEqual(FAKE_CALLER);
    const call = seen.at(-1);
    expect(call?.now).toEqual(NOW);
    expect(call?.headers[SOURCE_IP_HEADER]).toBe("198.51.100.7");
    expect(call?.headers["user-agent"]).toBe("claude-code/2.0");
  });

  it("has no caller over a header-less transport (stdio) and never calls identify", async () => {
    const identify = vi.fn<Identify>(() => FAKE_CALLER);
    expect(await overInMemory({ now: () => NOW, identify })).toBeNull();
    expect(identify).not.toHaveBeenCalled();
  });

  it("has no caller when identify returns undefined", async () => {
    expect(await overHttp({ now: () => NOW, identify: () => undefined }, {})).toBeNull();
  });

  it("defaults to identify() from the environment: a network caller with a secret", async () => {
    vi.stubEnv(CALLER_SECRET_ENV, "test-secret-not-real");
    vi.stubEnv(OPERATOR_TOKEN_ENV, "operator-token-not-real");
    const caller = await overHttp(
      { now: () => NOW },
      {
        [SOURCE_IP_HEADER]: "198.51.100.7",
        [OPERATOR_BYPASS_HEADER]: "operator-token-not-real",
      },
    );
    expect(caller).toMatchObject({ kind: "network", bypass: true });
    expect(JSON.stringify(caller)).not.toContain("198.51.100.7");
  });

  it("defaults to no caller, with one warning, when the secret is unset", async () => {
    vi.stubEnv(CALLER_SECRET_ENV, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await overHttp({ now: () => NOW }, { [SOURCE_IP_HEADER]: "198.51.100.7" })).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not warn about the secret on a request without a forwarded address", async () => {
    vi.stubEnv(CALLER_SECRET_ENV, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await overHttp({ now: () => NOW }, {})).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

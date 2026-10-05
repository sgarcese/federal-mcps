import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildCitation } from "../envelope/index.js";
import { ATTESTATION_HEADER } from "./attestation.js";
import type { Caller, Identify, RequestHeaders } from "./caller.js";
import { OPERATOR_BYPASS_HEADER, SOURCE_IP_HEADER } from "./caller.js";
import { type CreateServerOptions, createServer } from "./create-server.js";
import type { ServerDefinition, ToolDefinition } from "./definition.js";
import { createHttpHandler } from "./http.js";
import { CALLER_SECRET_ENV, OPERATOR_TOKEN_ENV } from "./identify.js";
import { lambdaRequestHeaders } from "./lambda-headers.js";

/**
 * The shell builds `ToolContext.caller` from the HTTP request's headers (#321, ADR-020 §1):
 * a tool handler sees the caller over Streamable HTTP when our Lambda adapter attested the
 * source address, and sees none over stdio or when a client sent the header itself.
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

/** Headers as the Lambda adapter replays them: the source address plus this process's attestation. */
function viaAdapter(sourceIp: string, extra: Record<string, string> = {}): Record<string, string> {
  return lambdaRequestHeaders({ headers: extra, requestContext: { http: { sourceIp } } });
}

function stubSecrets(): void {
  vi.stubEnv(CALLER_SECRET_ENV, "test-secret-not-real");
  vi.stubEnv(OPERATOR_TOKEN_ENV, "operator-token-not-real");
}

describe("createServer: caller identity through the adapter", () => {
  it("hands the handler the caller identify() builds from the adapter's headers", async () => {
    const seen: Array<{ headers: RequestHeaders; now: Date }> = [];
    const identify: Identify = (headers, now) => {
      seen.push({ headers, now });
      return FAKE_CALLER;
    };
    const caller = await overHttp(
      { now: () => NOW, identify },
      viaAdapter("198.51.100.7", { "User-Agent": "claude-code/2.0" }),
    );
    expect(caller).toEqual(FAKE_CALLER);
    const call = seen.at(-1);
    expect(call?.now).toEqual(NOW);
    expect(call?.headers[SOURCE_IP_HEADER]).toBe("198.51.100.7");
    expect(call?.headers["user-agent"]).toBe("claude-code/2.0");
    // The attestation stops at the shell: identify() never sees the nonce.
    expect(call?.headers[ATTESTATION_HEADER]).toBeUndefined();
  });

  it("has no caller over a header-less transport (stdio) and never calls identify", async () => {
    const identify = vi.fn<Identify>(() => FAKE_CALLER);
    expect(await overInMemory({ now: () => NOW, identify })).toBeNull();
    expect(identify).not.toHaveBeenCalled();
  });

  it("has no caller when identify returns undefined", async () => {
    expect(
      await overHttp({ now: () => NOW, identify: () => undefined }, viaAdapter("198.51.100.7")),
    ).toBeNull();
  });

  it("defaults to identify() from the environment: a network caller with a secret", async () => {
    stubSecrets();
    const caller = await overHttp(
      { now: () => NOW },
      viaAdapter("198.51.100.7", { [OPERATOR_BYPASS_HEADER]: "operator-token-not-real" }),
    );
    expect(caller).toMatchObject({ kind: "network", bypass: true });
    expect(JSON.stringify(caller)).not.toContain("198.51.100.7");
  });

  it("defaults to the pool for a claude.ai address the adapter attested", async () => {
    stubSecrets();
    const caller = await overHttp({ now: () => NOW }, viaAdapter("160.79.104.10"));
    expect(caller).toMatchObject({ kind: "pool", key: "claude-ai" });
  });

  it("defaults to no caller, with one warning, when the secret is unset", async () => {
    vi.stubEnv(CALLER_SECRET_ENV, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await overHttp({ now: () => NOW }, viaAdapter("198.51.100.7"))).toBeNull();
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

describe("createServer: a public handler with no adapter in front", () => {
  it("ignores a client-sent source header: no caller, identify never called", async () => {
    const identify = vi.fn<Identify>(() => FAKE_CALLER);
    expect(
      await overHttp({ now: () => NOW, identify }, { [SOURCE_IP_HEADER]: "198.51.100.7" }),
    ).toBeNull();
    expect(identify).not.toHaveBeenCalled();
  });

  it("ignores it under the default identify too, with a secret set and no warning", async () => {
    stubSecrets();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await overHttp({ now: () => NOW }, { [SOURCE_IP_HEADER]: "198.51.100.7" })).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("gives no pool caller to a client claiming a claude.ai address", async () => {
    stubSecrets();
    expect(await overHttp({ now: () => NOW }, { [SOURCE_IP_HEADER]: "160.79.104.10" })).toBeNull();
  });

  it("gives no caller for a wrong attestation, of any length", async () => {
    stubSecrets();
    const real = viaAdapter("198.51.100.7")[ATTESTATION_HEADER] ?? "";
    expect(real).not.toBe("");
    const forged = [
      "forged",
      "",
      "0".repeat(real.length),
      `${real.slice(0, -1)}${real.endsWith("0") ? "1" : "0"}`,
      `${real}0`,
    ];
    for (const attestation of forged) {
      const identify = vi.fn<Identify>(() => FAKE_CALLER);
      const caller = await overHttp(
        { now: () => NOW, identify },
        { [SOURCE_IP_HEADER]: "160.79.104.10", [ATTESTATION_HEADER]: attestation },
      );
      expect(caller, `attestation ${JSON.stringify(attestation)}`).toBeNull();
      expect(identify).not.toHaveBeenCalled();
    }
  });
});

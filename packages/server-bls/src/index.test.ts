import { rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Limiter } from "@federal-mcps/core";
import { GeographyCatalog } from "@federal-mcps/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { createBlsServer, describeSource, setCatalogForTest } from "./index.js";

let path: string;
let catalog: GeographyCatalog;
beforeAll(() => {
  path = buildFixtureCatalog();
  catalog = new GeographyCatalog(path);
  setCatalogForTest(catalog); // so createBlsServer needs no bundled file
});
afterAll(() => {
  catalog.close();
  rmSync(dirname(path), { recursive: true, force: true });
});

describe("@federal-mcps/server-bls entry point", () => {
  it("re-exports describeSource", () => {
    expect(describeSource().agency).toBe("bls");
  });

  it("createBlsServer builds the shell's server over the bundled catalog", () => {
    const server: McpServer = createBlsServer();
    expect(server).toBeDefined();
  });

  it("createBlsServer accepts createServer's options (e.g. an injectable clock)", () => {
    const now = () => new Date("2026-09-08T00:00:00.000Z");
    const server = createBlsServer({ now });
    expect(server).toBeDefined();
  });
});

describe("createBlsServer: the limiter (#322)", () => {
  it("hands options.limiter to the shell, which counts each tool call", async () => {
    const calls: unknown[] = [];
    const limiter: Limiter = {
      beginToolCall: async (caller) => {
        calls.push(caller);
      },
      beforeUpstream: async () => undefined,
      usage: async () => undefined,
    };
    const server = createBlsServer({ limiter });
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      await client.callTool({
        name: "bls_resolve_place",
        arguments: { query: "Denver", kind: "county" },
      });
      expect(calls).toEqual([undefined]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("createBlsServer: the limiter from the environment (#322)", () => {
  /** Calls bls_get_raw once with fetch stubbed; returns whether the call errored and fetch ran. */
  async function callRaw(limits: string | undefined) {
    vi.stubEnv("BLS_API_KEY", "test-key-not-real");
    vi.stubEnv("FEDERAL_MCPS_LIMITS", limits ?? "");
    vi.stubEnv("FEDERAL_MCPS_LIMITS_TABLE", "");
    // Off, not replay: this test proves the limiter stands before a real fetch (stubbed below).
    vi.stubEnv("FIXTURES", "off");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    const server = createBlsServer();
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      const result = await client.callTool({
        name: "bls_get_raw",
        arguments: { ids: ["LNU04000000"] },
      });
      return { isError: result.isError === true, fetched: fetchSpy.mock.calls.length > 0 };
    } finally {
      await client.close();
      await server.close();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  }

  it("charges the agency client's upstream fetch to the service budget", async () => {
    // A zero budget refuses before any fetch; without limits the same call reaches fetch.
    const limited = await callRaw(JSON.stringify({ serviceDaily: { bls: 0 } }));
    expect(limited).toEqual({ isError: true, fetched: false });
    const open = await callRaw(undefined);
    expect(open.fetched).toBe(true);
  });
});

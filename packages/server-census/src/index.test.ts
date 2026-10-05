import { rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Limiter } from "@federal-mcps/core";
import { GeographyCatalog } from "@federal-mcps/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { createCensusServer, describeSource, setCatalogForTest } from "./index.js";

let path: string;
let catalog: GeographyCatalog;
beforeAll(() => {
  path = buildFixtureCatalog();
  catalog = new GeographyCatalog(path);
  setCatalogForTest(catalog);
});
afterAll(() => {
  catalog.close();
  rmSync(dirname(path), { recursive: true, force: true });
});

describe("@federal-mcps/server-census entry point", () => {
  it("re-exports describeSource", () => {
    expect(describeSource().agency).toBe("census");
  });

  it("createCensusServer builds the shell's server over the bundled catalog", () => {
    const server: McpServer = createCensusServer();
    expect(server).toBeDefined();
  });
});

describe("createCensusServer: the limiter (#322)", () => {
  it("hands options.limiter to the shell, which counts each tool call", async () => {
    const calls: unknown[] = [];
    const limiter: Limiter = {
      beginToolCall: async (caller) => {
        calls.push(caller);
      },
      beforeUpstream: async () => undefined,
      usage: async () => undefined,
    };
    const server = createCensusServer({ limiter });
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      await client.callTool({
        name: "census_resolve_place",
        arguments: { query: "Denver", kind: "county" },
      });
      expect(calls).toEqual([undefined]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("createCensusServer: the limiter from the environment (#322)", () => {
  /** Calls census_get_raw once with fetch stubbed; returns whether the call errored and fetch ran. */
  async function callRaw(limits: string | undefined) {
    vi.stubEnv("CENSUS_API_KEY", "test-key-not-real");
    vi.stubEnv("FEDERAL_MCPS_LIMITS", limits ?? "");
    vi.stubEnv("FEDERAL_MCPS_LIMITS_TABLE", "");
    // Off, not replay: this test proves the limiter stands before a real fetch (stubbed below).
    vi.stubEnv("FIXTURES", "off");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    const server = createCensusServer();
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      const result = await client.callTool({
        name: "census_get_raw",
        arguments: {
          dataset: "acs/acs5",
          year: 2024,
          ids: ["NAME", "B19013_001E"],
          ucgid: "0500000US08031",
        },
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
    const limited = await callRaw(JSON.stringify({ serviceDaily: { census: 0 } }));
    expect(limited).toEqual({ isError: true, fetched: false });
    const open = await callRaw(undefined);
    expect(open.fetched).toBe(true);
  });
});

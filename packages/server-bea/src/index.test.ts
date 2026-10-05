import { rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Limiter } from "@federal-mcps/core";
import { GeographyCatalog } from "@federal-mcps/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import {
  BEA_ERRORS_PER_MINUTE,
  BEA_PER_MINUTE,
  createBeaServer,
  describeSource,
  resolveBeaErrorsPerMinute,
  resolveBeaPerMinute,
  setCatalogForTest,
} from "./index.js";

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

describe("@federal-mcps/server-bea entry point", () => {
  it("re-exports describeSource", () => {
    expect(describeSource().agency).toBe("bea");
  });

  it("createBeaServer builds the shell's server over the bundled catalog", () => {
    const server: McpServer = createBeaServer();
    expect(server).toBeDefined();
  });

  it("limits calls under BEA's 100 a minute (ADR-019 §4)", () => {
    expect(BEA_PER_MINUTE).toBe(90);
  });
});

describe("resolveBeaPerMinute / resolveBeaErrorsPerMinute (#324, ADR-020 §2)", () => {
  it("stay at today's constants when no limits config is given", () => {
    expect(resolveBeaPerMinute(undefined)).toBe(BEA_PER_MINUTE);
    expect(resolveBeaErrorsPerMinute(undefined)).toBe(BEA_ERRORS_PER_MINUTE);
  });

  it("splits BEA's 90/min across 2 reserved containers to 45", () => {
    expect(resolveBeaPerMinute({ upstreamPerMinute: { bea: 90 }, reservedConcurrency: 2 })).toBe(
      45,
    );
  });

  it("splits BEA's 30 errors/min across 2 reserved containers to 15", () => {
    expect(
      resolveBeaErrorsPerMinute({ upstreamErrorsPerMinute: { bea: 30 }, reservedConcurrency: 2 }),
    ).toBe(15);
  });
});

describe("createBeaServer: the limiter (#322)", () => {
  it("hands options.limiter to the shell, which counts each tool call", async () => {
    const calls: unknown[] = [];
    const limiter: Limiter = {
      beginToolCall: async (caller) => {
        calls.push(caller);
      },
      beforeUpstream: async () => undefined,
      usage: async () => undefined,
    };
    const server = createBeaServer({ limiter });
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      await client.callTool({
        name: "bea_resolve_place",
        arguments: { query: "Denver", kind: "county" },
      });
      expect(calls).toEqual([undefined]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("createBeaServer: the limiter from the environment (#322)", () => {
  /** Calls bea_get_raw once with fetch stubbed; returns whether the call errored and fetch ran. */
  async function callRaw(limits: string | undefined) {
    vi.stubEnv("BEA_API_KEY", "test-key-not-real");
    vi.stubEnv("FEDERAL_MCPS_LIMITS", limits ?? "");
    vi.stubEnv("FEDERAL_MCPS_LIMITS_TABLE", "");
    // Off, not replay: this test proves the limiter stands before a real fetch (stubbed below).
    vi.stubEnv("FIXTURES", "off");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    const server = createBeaServer();
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      const result = await client.callTool({
        name: "bea_get_raw",
        arguments: { table: "CAINC1", lineCode: 3, ids: ["18141"], years: [2024] },
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
    const limited = await callRaw(JSON.stringify({ serviceDaily: { bea: 0 } }));
    expect(limited).toEqual({ isError: true, fetched: false });
    const open = await callRaw(undefined);
    expect(open.fetched).toBe(true);
  });
});

import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    expect(
      resolveBeaPerMinute({ upstreamPerMinute: { bea: 90 }, reservedConcurrency: 2 }),
    ).toBe(45);
  });

  it("splits BEA's 30 errors/min across 2 reserved containers to 15", () => {
    expect(
      resolveBeaErrorsPerMinute({ upstreamErrorsPerMinute: { bea: 30 }, reservedConcurrency: 2 }),
    ).toBe(15);
  });
});

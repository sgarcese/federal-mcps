import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import {
  createHudServer,
  describeSource,
  HUD_USER_PER_MINUTE,
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

describe("@federal-mcps/server-hud entry point", () => {
  it("re-exports describeSource", () => {
    expect(describeSource().agency).toBe("hud");
  });

  it("createHudServer builds the shell's server over the bundled catalog", () => {
    const server: McpServer = createHudServer();
    expect(server).toBeDefined();
  });

  it("names the HUD User API's per-minute rate limit (#231's future core limiter)", () => {
    expect(HUD_USER_PER_MINUTE).toBe(60);
  });
});

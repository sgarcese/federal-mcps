import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog, type HttpClient } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildBeaDefinition } from "./definition.js";
import { beaIndicatorDefinitions } from "./indicators.js";

/**
 * The United States as a place (#290): this server reads BEA's county, state and metro tables, not
 * the national row, so every indicator answers "unavailable" for the nation with the reason — never
 * a crash, never an upstream call, never a misleading note about a missing state.
 */
let path: string;
let catalog: GeographyCatalog;
beforeAll(() => {
  path = buildFixtureCatalog();
  catalog = new GeographyCatalog(path);
});
afterAll(() => {
  catalog.close();
  rmSync(dirname(path), { recursive: true, force: true });
});

const noCalls: HttpClient = {
  getJson: () => {
    throw new Error("no BEA call is expected for the nation");
  },
  getText: () => {
    throw new Error("no BEA call is expected for the nation");
  },
  postJson: () => {
    throw new Error("no BEA call is expected for the nation");
  },
};

describe("bea_get_indicator for the United States (#290)", () => {
  it.each(beaIndicatorDefinitions.map((d) => d.name))(
    "%s is unavailable, with the reason",
    async (indicator) => {
      const get = buildBeaDefinition({
        catalog,
        httpClient: noCalls,
        apiKey: () => "unused",
      }).tools.find((t) => t.name === "bea_get_indicator");
      // biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
      const res = await get?.handler({ place: "United States", indicator } as any, {} as any);
      expect((res?.data as { status: string }).status).toBe("unavailable");
      expect(res?.place).toMatchObject({ geoid: "US", ucgid: "0100000US" });
      const limitations = res?.limitations?.join(" ") ?? "";
      expect(limitations).toMatch(/no national \(United States\) series/);
      expect(limitations).not.toMatch(/state could not be determined/);
    },
  );
});

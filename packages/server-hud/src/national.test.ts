import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog, type HttpClient } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildHudDefinition } from "./definition.js";
import { hudIndicatorDefinitions } from "./indicators.js";

/**
 * The United States as a place (#290): HUD User publishes no national figure through the endpoints
 * this server reads, so every indicator answers "unavailable" for the nation with the reason —
 * never a crash, never an upstream call.
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
    throw new Error("no HUD call is expected for the nation");
  },
  getText: () => {
    throw new Error("no HUD call is expected for the nation");
  },
  postJson: () => {
    throw new Error("no HUD call is expected for the nation");
  },
};

describe("hud_get_indicator for the United States (#290)", () => {
  it.each(hudIndicatorDefinitions.map((d) => d.name))(
    "%s is unavailable, with the reason",
    async (indicator) => {
      const get = buildHudDefinition({
        catalog,
        httpClient: noCalls,
        token: () => "unused",
      }).tools.find((t) => t.name === "hud_get_indicator");
      // biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
      const res = await get?.handler({ place: "United States", indicator } as any, {} as any);
      expect((res?.data as { status: string } | undefined)?.status).toBe("unavailable");
      expect(res?.place).toMatchObject({ geoid: "US", ucgid: "0100000US" });
      expect(res?.limitations?.join(" ")).toMatch(/no national \(United States\) series/);
    },
  );
});

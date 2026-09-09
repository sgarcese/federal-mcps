import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blsIndicatorTools } from "./get-indicator.js";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { scriptedBlsClient } from "./__fixtures__/scripted-client.js";

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

const NOW = () => new Date("2025-02-01T00:00:00Z");

function tool(client = scriptedBlsClient()) {
  return blsIndicatorTools({ catalog: () => catalog, httpClient: () => client, now: NOW })[0];
}

// biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
const run = (args: Record<string, unknown>) => tool().handler(args as any, {} as any);

describe("bls_get_indicator", () => {
  it("returns Denver County's unemployment rate with the series id, citation and footnotes", async () => {
    const res = await run({ place: "Denver", kind: "county", indicator: "unemployment_rate" });
    const data = res.data as {
      indicator?: string;
      measure?: string;
      latest: { period: string; value: number };
    };
    expect(res.source.ids).toEqual(["LAUCN080310000000003"]);
    expect(res.source.program).toBe("LAUS");
    expect(res.source.citation).toMatch(/Bureau of Labor Statistics.*LAUCN080310000000003/);
    expect(res.place?.geoid).toBe("08031");
    expect(data.latest).toEqual({ period: "2024-M12", value: 3.9 });
    expect(res.vintage).toBe("2024-M12");
    expect(res.footnotes?.[0]).toMatchObject({ code: "P", flags: ["preliminary"] });
  });

  it("builds the right series id per indicator and seasonal flag", async () => {
    const emp = await run({ place: "Denver", kind: "county", indicator: "employment" });
    expect(emp.source.ids).toEqual(["LAUCN080310000000005"]); // measure 05 = employment
    const sa = await run({
      place: "Denver",
      kind: "county",
      indicator: "unemployment_rate",
      seasonallyAdjusted: true,
    });
    expect(sa.source.ids).toEqual(["LASCN080310000000003"]); // S = seasonally adjusted
  });

  it("falls back to the county for a below-threshold city, with an explicit caveat", async () => {
    const res = await run({ place: "Smallburg", kind: "city", indicator: "unemployment_rate" });
    expect(res.place?.geoid).toBe("08031"); // reported as the county
    expect(res.source.ids).toEqual(["LAUCN080310000000003"]); // county's LAUS series
    expect(res.limitations?.join(" ")).toMatch(/below the LAUS 25,000 city threshold/);
    expect(res.limitations?.join(" ")).toMatch(/Denver County/);
  });

  it("stops as ambiguous when a bare name means several kinds", async () => {
    const res = await run({ place: "Denver", indicator: "unemployment_rate" });
    const data = res.data as { status: string };
    expect(data.status).toBe("ambiguous");
    expect(res.source.ids).toEqual([]);
  });

  it("returns not_found for a name that resolves to nothing", async () => {
    const res = await run({ place: "Nowheresville", indicator: "unemployment_rate" });
    expect((res.data as { status: string }).status).toBe("not_found");
  });
});

import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { setCatalogForTest } from "@federal-mcps/server-geo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BenchItem } from "./benchmark.js";
import { connectGeoClient, runWithoutTools, runWithTools, toolSpecs } from "./arms.js";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import type { Model, ToolExecutor, ToolSpec } from "./model.js";

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

const item: BenchItem = {
  id: "T01",
  category: "containment",
  kg_relation: "containment",
  answer_type: "rubric",
  question: "What county is Denver in?",
  ground_truth: "Denver County (08031)",
  source: "test",
};

/** A model that, when given tools, calls geo_resolve_place once and quotes the result. */
function toolUsingFake(): Model {
  return {
    name: "fake",
    async answer(_question: string, tools: ToolSpec[] | null, exec: ToolExecutor) {
      if (!tools || tools.length === 0) return "I think Denver is its own thing.";
      const result = await exec("geo_resolve_place", { query: "Denver", kind: "county" });
      return `Tools say: ${result}`;
    },
  };
}

describe("benchmark arms", () => {
  it("exposes the geography tools to the model", async () => {
    const client = await connectGeoClient();
    try {
      const names = (await toolSpecs(client)).map((t) => t.name);
      expect(names).toContain("geo_resolve_place");
    } finally {
      await client.close();
    }
  });

  it("the closed-book arm answers with no tool access", async () => {
    const [answer] = await runWithoutTools([item], toolUsingFake());
    expect(answer?.arm).toBe("without_tools");
    expect(answer?.text).toMatch(/its own thing/);
  });

  it("the tool arm runs a real tool call and the model sees the result", async () => {
    const client = await connectGeoClient();
    try {
      const [answer] = await runWithTools([item], toolUsingFake(), client);
      expect(answer?.arm).toBe("with_tools");
      // The resolver returned Denver County's GEOID through the tool executor.
      expect(answer?.text).toContain("08031");
    } finally {
      await client.close();
    }
  });
});

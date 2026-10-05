import { rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  createHttpClient,
  GeographyCatalog,
  type HttpClient,
  type HttpResult,
  MemoryBudgetStore,
  MemoryCacheStore,
} from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildBlsDefinition } from "./definition.js";
import { stubHttpClient } from "./__fixtures__/stub-client.js";

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

describe("BLS ServerDefinition", () => {
  it("names the server and agency per ADR-001/ADR-004", () => {
    const definition = buildBlsDefinition({ catalog, httpClient: stubHttpClient() });
    expect(definition.name).toBe("federal-mcps-bls");
    expect(definition.agency).toBe("bls");
    expect(definition.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("mounts bls_resolve_place from the shared resolver (fromCore, no own lookup)", () => {
    const tools = buildBlsDefinition({ catalog, httpClient: stubHttpClient() }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      "bls_resolve_place",
      "bls_get_indicator",
      "bls_compare_places",
      "bls_list_indicators",
      "bls_get_raw",
    ]);
    expect(tools[0]?.fromCore).toBe(true);
  });

  it("drafts instructions from the geography spike's city/county/metro guidance", () => {
    const text = buildBlsDefinition({
      catalog,
      httpClient: stubHttpClient(),
    }).instructions.toLowerCase();
    expect(text).toContain("county");
    expect(text).toContain("metro");
    expect(text).toContain("denver");
    expect(text).toContain("25,000");
    expect(text).toContain("provenance");
    expect(text).toContain("bls_resolve_place");
    // LAUS data tools shipped in M3: the instructions must say so, not call them "planned".
    expect(text).toContain("bls_get_indicator");
    expect(text).not.toContain('listed as "planned" right now');
  });

  it("tells the model the United States is a place with a national benchmark from CPS (#290)", () => {
    const text = buildBlsDefinition({ catalog, httpClient: stubHttpClient() }).instructions;
    expect(text).toMatch(/United States/);
    expect(text).toMatch(/Current Population Survey/);
  });

  it("keeps instructions to a model-sized paragraph or two", () => {
    const wordCount = buildBlsDefinition({ catalog, httpClient: stubHttpClient() })
      .instructions.trim()
      .split(/\s+/).length;
    expect(wordCount).toBeGreaterThan(200);
    expect(wordCount).toBeLessThan(600);
  });

  it("exposes describeSource() backing the auto-registered tool", () => {
    const definition = buildBlsDefinition({ catalog, httpClient: stubHttpClient() });
    expect(typeof definition.describeSource).toBe("function");
    expect(definition.describeSource().agency).toBe("bls");
  });
});

const QCEW_CSV = [
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage"',
  '"08031","0","10","70","0","2024","1","",45970,559807,561820,561041,15497545518,7590975514,149132980,2125',
].join("\n");

function qcewTextClient(): HttpClient {
  return {
    getJson: () => {
      throw new Error("only getText");
    },
    postJson: () => {
      throw new Error("only getText");
    },
    async getText(): Promise<HttpResult<string>> {
      return { value: QCEW_CSV, status: 200, cache: { hit: false } };
    },
  };
}

function neverCalledClient(label: string): HttpClient {
  const fail = () => {
    throw new Error(`${label} must not be called for QCEW`);
  };
  return { getJson: fail, getText: fail, postJson: fail };
}

async function getCoveredEmployment(definition: ReturnType<typeof buildBlsDefinition>) {
  const tool = definition.tools.find((t) => t.name === "bls_get_indicator");
  if (!tool) throw new Error("no bls_get_indicator tool");
  const args = { place: "Denver", kind: "county", indicator: "covered_employment" };
  // biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
  const res = await tool.handler(args as any, {} as any);
  return res.data as { latest: { period: string; value: number } | null };
}

describe("BLS ServerDefinition: QCEW's own HTTP client via dependency injection (#324 review)", () => {
  it("fetches QCEW through qcewHttpClient instead of the main httpClient when it is set", async () => {
    const definition = buildBlsDefinition({
      catalog,
      httpClient: neverCalledClient("the main BLS client"),
      qcewHttpClient: qcewTextClient(),
    });
    const data = await getCoveredEmployment(definition);
    expect(data.latest).toEqual({ period: "2024-Q01", value: 560889 });
  });

  it("falls back to the main httpClient when qcewHttpClient is unset (unchanged behaviour)", async () => {
    const definition = buildBlsDefinition({ catalog, httpClient: qcewTextClient() });
    const data = await getCoveredEmployment(definition);
    expect(data.latest).toEqual({ period: "2024-Q01", value: 560889 });
  });

  it("does not decrement the bls budget when qcewHttpClient has its own budget key", async () => {
    const blsBudget = new MemoryBudgetStore(500);
    const qcewBudget = new MemoryBudgetStore(500);
    const qcewClient = createHttpClient({
      source: "bls-qcew",
      budget: qcewBudget,
      cache: new MemoryCacheStore(),
      fetch: async () => new Response(QCEW_CSV),
      fixtures: { mode: "off" },
    });
    const definition = buildBlsDefinition({
      catalog,
      httpClient: neverCalledClient("the main BLS client"),
      qcewHttpClient: qcewClient,
    });
    await getCoveredEmployment(definition);

    expect((await blsBudget.consume("bls", 0)).remaining).toBe(500); // untouched
    expect((await qcewBudget.consume("bls-qcew", 0)).remaining).toBeLessThan(500);
  });

  it("does not cross-contaminate: two definitions built with different QCEW clients in one process stay separate (the regression a module-level setter allowed)", async () => {
    const csvB = [
      '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage"',
      '"08031","0","10","70","0","2024","1","",1,1,1,1,1,1,1,999',
    ].join("\n");
    const clientA = qcewTextClient();
    const clientB: HttpClient = {
      getJson: () => {
        throw new Error("only getText");
      },
      postJson: () => {
        throw new Error("only getText");
      },
      async getText(): Promise<HttpResult<string>> {
        return { value: csvB, status: 200, cache: { hit: false } };
      },
    };

    const definitionA = buildBlsDefinition({
      catalog,
      httpClient: neverCalledClient("A's main client"),
      qcewHttpClient: clientA,
    });
    const definitionB = buildBlsDefinition({
      catalog,
      httpClient: neverCalledClient("B's main client"),
      qcewHttpClient: clientB,
    });

    const [dataA, dataB] = await Promise.all([
      getCoveredEmployment(definitionA),
      getCoveredEmployment(definitionB),
    ]);

    expect(dataA.latest?.value).toBe(560889); // A's own client's figure
    expect(dataB.latest?.value).toBe(1); // B's own client's figure (average of its month1/2/3 = 1), clearly distinct from A's

    // Re-reading A after B was built proves A was never swapped for B's client.
    const dataAAgain = await getCoveredEmployment(definitionA);
    expect(dataAAgain.latest?.value).toBe(560889);
  });
});

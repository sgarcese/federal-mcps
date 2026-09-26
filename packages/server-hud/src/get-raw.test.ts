import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  type HttpClient,
  HttpError,
  MemoryBudgetStore,
  MemoryCacheStore,
  RAW_TEXT_BUDGET,
  renderText,
} from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { HUD_USER_REQUIRED_SENTENCE } from "./describe-source.js";
import { buildHudRawUrl, hudGetRawTool, renderHudRaw } from "./get-raw.js";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const replay = () =>
  createHttpClient({
    source: "hud",
    budget: new MemoryBudgetStore(100),
    cache: new MemoryCacheStore(),
    fixtures: { mode: "replay", dir: FIXTURES },
  });
const NOW = new Date("2026-09-26T12:00:00Z");
const tool = (
  client: () => HttpClient = replay,
  token: () => string | undefined = () => "test-token",
) => hudGetRawTool({ httpClient: client, token, now: () => NOW });
// biome-ignore lint/suspicious/noExplicitAny: handler args and envelope data are untyped in tests.
type AnyArgs = any;
const call = (args: Record<string, unknown>, t = tool()) =>
  t.handler(args as AnyArgs, {} as AnyArgs);

describe("buildHudRawUrl reuses the recorded URL builders (fixtures hash the exact URL)", () => {
  it("fmr, il and mtspil: entity path, optional ?year", () => {
    expect(buildHudRawUrl({ endpoint: "fmr" }, "1814199999")).toBe(
      "https://www.huduser.gov/hudapi/public/fmr/data/1814199999",
    );
    expect(buildHudRawUrl({ endpoint: "il", year: 2025 }, "1814199999")).toBe(
      "https://www.huduser.gov/hudapi/public/il/data/1814199999?year=2025",
    );
    expect(buildHudRawUrl({ endpoint: "mtspil" }, "1814199999")).toBe(
      "https://www.huduser.gov/hudapi/public/mtspil/data/1814199999",
    );
  });

  it("chas: type, stateId, entityId, optional release", () => {
    expect(buildHudRawUrl({ endpoint: "chas", type: 2, stateId: 18 }, undefined)).toBe(
      "https://www.huduser.gov/hudapi/public/chas?type=2&stateId=18",
    );
    expect(
      buildHudRawUrl(
        {
          endpoint: "chas",
          type: 3,
          stateId: 18,
          release: "2017-2021",
        },
        "141",
      ),
    ).toBe(
      "https://www.huduser.gov/hudapi/public/chas?type=3&stateId=18&entityId=141&year=2017-2021",
    );
  });

  it("picture: type, year, census vintage from the year, statecode, entityid", () => {
    expect(
      buildHudRawUrl(
        {
          endpoint: "picture",
          type: 9,
          year: 2024,
          statecode: "IN",
        },
        "18141",
      ),
    ).toBe(
      "https://www.huduser.gov/hudapi/public/picture?type=9&year=2024&census=2020&statecode=IN&entityid=18141",
    );
    expect(buildHudRawUrl({ endpoint: "picture", type: 5, year: 2024 }, "43780")).toBe(
      "https://www.huduser.gov/hudapi/public/picture?type=5&year=2024&census=2020&entityid=43780",
    );
  });
});

describe("hud_get_raw input validation (each endpoint takes only its own parameters)", () => {
  it.each([
    ["fmr without entityid", { endpoint: "fmr" }],
    ["fmr with a CHAS release", { endpoint: "fmr", ids: ["1814199999"], release: "2018-2022" }],
    ["an entity id with a path character", { endpoint: "il", ids: ["18141/../x"] }],
    [
      "more than ten ids",
      { endpoint: "fmr", ids: Array.from({ length: 11 }, (_, i) => `18${i}99999`) },
    ],
    ["chas with a Picture type", { endpoint: "chas", type: 9, stateId: 18, ids: ["141"] }],
    ["chas county without entityid", { endpoint: "chas", type: 3, stateId: 18 }],
    ["chas with a numeric year", { endpoint: "chas", type: 2, stateId: 18, year: 2022 }],
    ["picture without year", { endpoint: "picture", type: 9, statecode: "IN", ids: ["18141"] }],
    [
      "picture county without statecode",
      { endpoint: "picture", type: 9, year: 2024, ids: ["18141"] },
    ],
    ["an unknown endpoint", { endpoint: "hmda", ids: ["1814199999"] }],
  ])("rejects %s", async (_label, args) => {
    await expect(call(args)).rejects.toThrow();
  });
});

describe("hud_get_raw against recorded responses", () => {
  it("returns HUD's response unchanged with a citation that carries the required sentence", async () => {
    const res = await call({ endpoint: "fmr", ids: ["1814199999"] });
    const data = res.data as AnyArgs;
    expect(data.endpoint).toBe("fmr");
    expect(data.responses[0].response.data.county_name).toBe("St. Joseph County, IN");
    expect(res.source.agency).toBe("hud");
    expect(res.source.program).toBe("FMR");
    expect(res.source.ids).toEqual(["https://www.huduser.gov/hudapi/public/fmr/data/1814199999"]);
    expect(res.source.citation).toMatch(/^U\.S\. Department of Housing and Urban Development, FMR/);
    expect(res.source.citation.endsWith(HUD_USER_REQUIRED_SENTENCE)).toBe(true);
  });

  it("fetches several entities in one call, one response and one cited URL each", async () => {
    const res = await call({ endpoint: "fmr", ids: ["1814199999", "1703199999"] });
    const data = res.data as AnyArgs;
    expect(data.responses.map((r: AnyArgs) => r.id)).toEqual(["1814199999", "1703199999"]);
    expect(res.source.ids).toEqual([
      "https://www.huduser.gov/hudapi/public/fmr/data/1814199999",
      "https://www.huduser.gov/hudapi/public/fmr/data/1703199999",
    ]);
    const r = renderHudRaw(res.data);
    expect(r?.unit).toBe("responses");
    expect(r?.items[0]?.startsWith("id 1814199999")).toBe(true);
  });

  it("never puts the token in the envelope", async () => {
    const res = await call({ endpoint: "chas", type: 3, stateId: 18, ids: ["141"] });
    expect(JSON.stringify(res)).not.toContain("test-token");
  });

  it("reports HUD's no-data answer (400/404) as a limitation with no response, never a guess", async () => {
    const noData: () => HttpClient = () =>
      ({
        getJson: async (url: string) => {
          throw new HttpError({ source: "hud", status: 400, url, attempts: 1 });
        },
      }) as unknown as HttpClient;
    const res = await call({ endpoint: "fmr", ids: ["1814199999"], year: 2016 }, tool(noData));
    expect((res.data as AnyArgs).responses[0].response).toBeNull();
    expect((res.limitations ?? []).join(" ")).toMatch(/no data/i);
  });

  it("refuses without a token, naming HUD_USER_TOKEN", async () => {
    await expect(
      call(
        { endpoint: "fmr", ids: ["1814199999"] },
        tool(replay, () => undefined),
      ),
    ).rejects.toThrow(/HUD_USER_TOKEN/);
  });
});

describe("renderHudRaw (ADR-017 compact text)", () => {
  it("renders a single FMR record as one line per field", async () => {
    const res = await call({ endpoint: "fmr", ids: ["1814199999"] });
    const r = renderHudRaw(res.data);
    expect(r?.unit).toBe("fields");
    expect(r?.items).toContain("county_name: St. Joseph County, IN");
    expect(r?.items.some((i) => /^basicdata\.Two-Bedroom: \d+$/.test(i))).toBe(true);
  });

  it("renders Small Area FMRs as a ZIP table: all 371 rows fit the raw budget; a tighter budget cuts on whole rows", async () => {
    const res = await call({ endpoint: "fmr", ids: ["1703199999"] });
    const r = renderHudRaw(res.data);
    expect(r?.unit).toBe("rows");
    expect(r?.head).toContain(
      "columns: zip_code,Efficiency,One-Bedroom,Two-Bedroom,Three-Bedroom,Four-Bedroom",
    );
    expect(r?.items).toHaveLength(371);
    const envelope = { footnotes: [], limitations: [], ...res, retrievedAt: NOW.toISOString() };
    const full = renderText(envelope as AnyArgs, {
      renderData: renderHudRaw,
      textBudget: RAW_TEXT_BUDGET,
    });
    expect(full.length).toBeLessThan(RAW_TEXT_BUDGET);
    expect(full).not.toMatch(/showing/);
    const cut = renderText(envelope as AnyArgs, { renderData: renderHudRaw, textBudget: 2000 });
    expect(cut).toMatch(/showing \d+ of 371 rows/);
  });

  it("renders a single CHAS record (132 fields) as field lines", async () => {
    const res = await call({ endpoint: "chas", type: 3, stateId: 18, ids: ["141"] });
    const r = renderHudRaw(res.data);
    expect(r?.unit).toBe("fields");
    expect(r?.items.some((i) => i.startsWith("A1: "))).toBe(true);
  });

  it("renders Picture's program rows as a table with the query's metadata in the head", async () => {
    const res = await call({
      endpoint: "picture",
      type: 9,
      year: 2024,
      statecode: "IN",
      ids: ["18141"],
    });
    const r = renderHudRaw(res.data);
    expect(r?.unit).toBe("rows");
    expect(r?.head).toContain("year: 2024");
    expect(r?.head.find((h) => h.startsWith("columns: "))).toContain("program_label");
    expect(r?.items.length).toBeGreaterThan(1);
  });

  it("declines on a no-data envelope so the shell falls back to JSON", () => {
    expect(
      renderHudRaw({ endpoint: "fmr", query: {}, responses: [{ url: "u", response: null }] }),
    ).toBeUndefined();
  });
});

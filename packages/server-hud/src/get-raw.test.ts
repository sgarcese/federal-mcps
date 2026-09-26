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
    expect(buildHudRawUrl({ endpoint: "fmr", entityid: "1814199999" })).toBe(
      "https://www.huduser.gov/hudapi/public/fmr/data/1814199999",
    );
    expect(buildHudRawUrl({ endpoint: "il", entityid: "1814199999", year: 2025 })).toBe(
      "https://www.huduser.gov/hudapi/public/il/data/1814199999?year=2025",
    );
    expect(buildHudRawUrl({ endpoint: "mtspil", entityid: "1814199999" })).toBe(
      "https://www.huduser.gov/hudapi/public/mtspil/data/1814199999",
    );
  });

  it("chas: type, stateId, entityId, optional release", () => {
    expect(buildHudRawUrl({ endpoint: "chas", type: 2, stateId: 18 })).toBe(
      "https://www.huduser.gov/hudapi/public/chas?type=2&stateId=18",
    );
    expect(
      buildHudRawUrl({
        endpoint: "chas",
        type: 3,
        stateId: 18,
        entityid: "141",
        release: "2017-2021",
      }),
    ).toBe(
      "https://www.huduser.gov/hudapi/public/chas?type=3&stateId=18&entityId=141&year=2017-2021",
    );
  });

  it("picture: type, year, census vintage from the year, statecode, entityid", () => {
    expect(
      buildHudRawUrl({
        endpoint: "picture",
        type: 9,
        year: 2024,
        statecode: "IN",
        entityid: "18141",
      }),
    ).toBe(
      "https://www.huduser.gov/hudapi/public/picture?type=9&year=2024&census=2020&statecode=IN&entityid=18141",
    );
    expect(buildHudRawUrl({ endpoint: "picture", type: 5, year: 2024, entityid: "43780" })).toBe(
      "https://www.huduser.gov/hudapi/public/picture?type=5&year=2024&census=2020&entityid=43780",
    );
  });
});

describe("hud_get_raw input validation (each endpoint takes only its own parameters)", () => {
  it.each([
    ["fmr without entityid", { endpoint: "fmr" }],
    ["fmr with a CHAS release", { endpoint: "fmr", entityid: "1814199999", release: "2018-2022" }],
    ["an entity id with a path character", { endpoint: "il", entityid: "18141/../x" }],
    ["chas with a Picture type", { endpoint: "chas", type: 9, stateId: 18, entityid: "141" }],
    ["chas county without entityid", { endpoint: "chas", type: 3, stateId: 18 }],
    ["chas with a numeric year", { endpoint: "chas", type: 2, stateId: 18, year: 2022 }],
    ["picture without year", { endpoint: "picture", type: 9, statecode: "IN", entityid: "18141" }],
    [
      "picture county without statecode",
      { endpoint: "picture", type: 9, year: 2024, entityid: "18141" },
    ],
    ["an unknown endpoint", { endpoint: "hmda", entityid: "1814199999" }],
  ])("rejects %s", async (_label, args) => {
    await expect(call(args)).rejects.toThrow();
  });
});

describe("hud_get_raw against recorded responses", () => {
  it("returns HUD's response unchanged with a citation that carries the required sentence", async () => {
    const res = await call({ endpoint: "fmr", entityid: "1814199999" });
    const data = res.data as AnyArgs;
    expect(data.endpoint).toBe("fmr");
    expect(data.response.data.county_name).toBe("St. Joseph County, IN");
    expect(res.source.agency).toBe("hud");
    expect(res.source.program).toBe("FMR");
    expect(res.source.ids).toEqual(["https://www.huduser.gov/hudapi/public/fmr/data/1814199999"]);
    expect(res.source.citation).toMatch(/^U\.S\. Department of Housing and Urban Development, FMR/);
    expect(res.source.citation.endsWith(HUD_USER_REQUIRED_SENTENCE)).toBe(true);
  });

  it("never puts the token in the envelope", async () => {
    const res = await call({ endpoint: "chas", type: 3, stateId: 18, entityid: "141" });
    expect(JSON.stringify(res)).not.toContain("test-token");
  });

  it("reports HUD's no-data answer (400/404) as a limitation with no response, never a guess", async () => {
    const noData: () => HttpClient = () =>
      ({
        getJson: async (url: string) => {
          throw new HttpError({ source: "hud", status: 400, url, attempts: 1 });
        },
      }) as unknown as HttpClient;
    const res = await call({ endpoint: "fmr", entityid: "1814199999", year: 2016 }, tool(noData));
    expect((res.data as AnyArgs).response).toBeNull();
    expect((res.limitations ?? []).join(" ")).toMatch(/no data/i);
  });

  it("refuses without a token, naming HUD_USER_TOKEN", async () => {
    await expect(
      call(
        { endpoint: "fmr", entityid: "1814199999" },
        tool(replay, () => undefined),
      ),
    ).rejects.toThrow(/HUD_USER_TOKEN/);
  });
});

describe("renderHudRaw (ADR-017 compact text)", () => {
  it("renders a single FMR record as one line per field", async () => {
    const res = await call({ endpoint: "fmr", entityid: "1814199999" });
    const r = renderHudRaw(res.data);
    expect(r?.unit).toBe("fields");
    expect(r?.items).toContain("county_name: St. Joseph County, IN");
    expect(r?.items.some((i) => /^basicdata\.Two-Bedroom: \d+$/.test(i))).toBe(true);
  });

  it("renders Small Area FMRs as a ZIP table and cuts it to the raw budget with a notice", async () => {
    const res = await call({ endpoint: "fmr", entityid: "1703199999" });
    const r = renderHudRaw(res.data);
    expect(r?.unit).toBe("rows");
    expect(r?.head).toContain(
      "columns: zip_code,Efficiency,One-Bedroom,Two-Bedroom,Three-Bedroom,Four-Bedroom",
    );
    expect(r?.items).toHaveLength(371);
    const text = renderText({ ...res, retrievedAt: NOW.toISOString() } as AnyArgs, {
      renderData: renderHudRaw,
      textBudget: RAW_TEXT_BUDGET,
    });
    expect(text.length).toBeLessThan(RAW_TEXT_BUDGET + 2000);
  });

  it("renders a single CHAS record (132 fields) as field lines", async () => {
    const res = await call({ endpoint: "chas", type: 3, stateId: 18, entityid: "141" });
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
      entityid: "18141",
    });
    const r = renderHudRaw(res.data);
    expect(r?.unit).toBe("rows");
    expect(r?.head).toContain("year: 2024");
    expect(r?.head.find((h) => h.startsWith("columns: "))).toContain("program_label");
    expect(r?.items.length).toBeGreaterThan(1);
  });

  it("declines on a no-data envelope so the shell falls back to JSON", () => {
    expect(renderHudRaw({ endpoint: "fmr", query: {}, response: null })).toBeUndefined();
  });
});

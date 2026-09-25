import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  type HttpClient,
  HttpError,
  MemoryBudgetStore,
  MemoryCacheStore,
  type PlaceCandidate,
  uspsOfStateFips,
} from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import {
  chasEntityOf,
  chasUrl,
  fmrEntityOf,
  fmrUrl,
  hudGetJson,
  ilUrl,
  mtspUrl,
  pictureCensusFor,
  pictureEntityOf,
  pictureUrl,
} from "./hud-api.js";

/** A resolved-place stand-in: only the fields the builders read. */
const place = (sumlevel: string, geoid: string, stateFips: string | null): PlaceCandidate =>
  ({ geoid, kind: { sumlevel, label: "" }, stateFips }) as unknown as PlaceCandidate;

const ST_JOSEPH = place("050", "18141", "18");
const SOUTH_BEND = place("160", "1871000", "18");
const INDIANA = place("040", "18", "18");
const SOUTH_BEND_METRO = place("310", "43780", null);
const TRACT = place("140", "18141011300", "18");
const SUFFOLK_MA = place("050", "25025", "25");

describe("core state codes for HUD (#232)", () => {
  it("maps a state FIPS to its USPS code", () => {
    expect(uspsOfStateFips("18")).toBe("IN");
    expect(uspsOfStateFips("26")).toBe("MI");
    expect(uspsOfStateFips("99")).toBeUndefined();
  });
});

describe("entity ids from a resolved place (verified live 2026-09-24)", () => {
  it("FMR/IL: a county is SSCCC99999; places, metros and New England counties have no direct id", () => {
    expect(fmrEntityOf(ST_JOSEPH)).toBe("1814199999");
    expect(fmrEntityOf(SOUTH_BEND)).toBeUndefined();
    expect(fmrEntityOf(SOUTH_BEND_METRO)).toBeUndefined();
    // HUD publishes New England FMR/IL by town; a county id returns 404 there.
    expect(fmrEntityOf(SUFFOLK_MA)).toBeUndefined();
  });

  it("CHAS: state type 2, county type 3 (stateId + 3-digit county), place type 5 (stateId + 5-digit place)", () => {
    expect(chasEntityOf(INDIANA)).toEqual({ type: 2, stateId: 18 });
    expect(chasEntityOf(ST_JOSEPH)).toEqual({ type: 3, stateId: 18, entityId: 141 });
    expect(chasEntityOf(SOUTH_BEND)).toEqual({ type: 5, stateId: 18, entityId: 71000 });
    expect(chasEntityOf(TRACT)).toBeUndefined();
  });

  it("Picture: state 3, county 9, city 8, tract 7, CBSA 5 — FIPS entity ids, USPS state codes", () => {
    expect(pictureEntityOf(INDIANA)).toEqual({ type: 3, statecode: "IN" });
    expect(pictureEntityOf(ST_JOSEPH)).toEqual({ type: 9, statecode: "IN", entityid: "18141" });
    expect(pictureEntityOf(SOUTH_BEND)).toEqual({ type: 8, statecode: "IN", entityid: "1871000" });
    expect(pictureEntityOf(TRACT)).toEqual({ type: 7, statecode: "IN", entityid: "18141011300" });
    expect(pictureEntityOf(SOUTH_BEND_METRO)).toEqual({ type: 5, entityid: "43780" });
  });

  it("Picture's census vintage: 2010 through 2021, 2020 from 2022", () => {
    expect(pictureCensusFor(2012)).toBe(2010);
    expect(pictureCensusFor(2021)).toBe(2010);
    expect(pictureCensusFor(2022)).toBe(2020);
    expect(pictureCensusFor(2025)).toBe(2020);
  });
});

describe("URLs (fixtures hash these exact strings)", () => {
  it("builds each endpoint with a fixed parameter order", () => {
    expect(fmrUrl("1814199999")).toBe("https://www.huduser.gov/hudapi/public/fmr/data/1814199999");
    expect(fmrUrl("1814199999", 2026)).toBe(
      "https://www.huduser.gov/hudapi/public/fmr/data/1814199999?year=2026",
    );
    expect(ilUrl("1814199999", 2025)).toBe(
      "https://www.huduser.gov/hudapi/public/il/data/1814199999?year=2025",
    );
    expect(mtspUrl("1814199999")).toBe(
      "https://www.huduser.gov/hudapi/public/mtspil/data/1814199999",
    );
    expect(chasUrl({ type: 3, stateId: 18, entityId: 141 }, "2017-2021")).toBe(
      "https://www.huduser.gov/hudapi/public/chas?type=3&stateId=18&entityId=141&year=2017-2021",
    );
    expect(pictureUrl({ type: 9, statecode: "IN", entityid: "18141" }, 2024)).toBe(
      "https://www.huduser.gov/hudapi/public/picture?type=9&year=2024&census=2020&statecode=IN&entityid=18141",
    );
  });
});

describe("hudGetJson over recorded fixtures (the token never reaches disk)", () => {
  const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
  const replay = () =>
    createHttpClient({
      source: "hud",
      budget: new MemoryBudgetStore(100),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "replay", dir: FIXTURES },
    });

  it("returns the parsed body for a published entity", async () => {
    const body = await hudGetJson<{ data: { area_name: string } }>(
      replay(),
      fmrUrl("1814199999"),
      () => "test-token",
    );
    expect(body?.data.area_name).toMatch(/South Bend/);
  });

  it("returns undefined when HUD has no data for the entity or year (404/400), never a guess", async () => {
    // FY2016 answers 400 live (verified 2026-09-24); errors are not recorded, so stub the client.
    const noData = (status: number): HttpClient =>
      ({
        getJson: async (url: string) => {
          throw new HttpError({ source: "hud", status, url, attempts: 1 });
        },
      }) as unknown as HttpClient;
    expect(await hudGetJson(noData(400), fmrUrl("1814199999", 2016), () => "t")).toBeUndefined();
    expect(await hudGetJson(noData(404), fmrUrl("2502599999"), () => "t")).toBeUndefined();
    await expect(hudGetJson(noData(500), fmrUrl("1814199999"), () => "t")).rejects.toThrow();
  });

  it("refuses to call without a token, naming HUD_USER_TOKEN", async () => {
    await expect(hudGetJson(replay(), fmrUrl("1814199999"), () => undefined)).rejects.toThrow(
      /HUD_USER_TOKEN/,
    );
  });

  it("no fixture records a request credential (the token rides as a request header only)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = `${FIXTURES}/hud`;
    for (const f of readdirSync(dir)) {
      const record = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as {
        headers: Record<string, string>;
      };
      // HUD's CORS header lists "Authorization" as an allowed header name; no value may appear.
      expect(Object.keys(record.headers).map((k) => k.toLowerCase())).not.toContain(
        "authorization",
      );
      expect(JSON.stringify(record)).not.toMatch(/bearer\s/i);
    }
  });
});

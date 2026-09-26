import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  createServer,
  GeographyCatalog,
  MemoryBudgetStore,
  MemoryCacheStore,
  type PlaceCandidate,
} from "@federal-mcps/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import {
  chasAgencyCodeOf,
  chasBuildSeriesId,
  chasIndicatorDefinitions,
} from "./chas-indicators.js";
import { buildHudDefinition } from "./definition.js";

/** A resolved-place stand-in: only the fields the builders read (mirrors hud-api.test.ts). */
const place = (sumlevel: string, geoid: string): PlaceCandidate =>
  ({ geoid, kind: { sumlevel, label: "" } }) as unknown as PlaceCandidate;

const INDIANA = place("040", "18");
const ST_JOSEPH = place("050", "18141");
const SOUTH_BEND = place("160", "1871000");
const SOUTH_BEND_METRO = place("310", "43780");
const TRACT = place("140", "18141011300");

describe("chasAgencyCodeOf / chasBuildSeriesId (#235)", () => {
  it("encodes state, county and place entities; tract and metro have none", () => {
    expect(chasAgencyCodeOf(INDIANA)).toBe("2:18:");
    expect(chasAgencyCodeOf(ST_JOSEPH)).toBe("3:18:141");
    expect(chasAgencyCodeOf(SOUTH_BEND)).toBe("5:18:71000");
    expect(chasAgencyCodeOf(TRACT)).toBeUndefined();
    expect(chasAgencyCodeOf(SOUTH_BEND_METRO)).toBeUndefined();
  });

  it("appends the resolved level (default 30) to the agency code", () => {
    expect(chasBuildSeriesId("3:18:141", undefined)).toBe("3:18:141|30");
    expect(chasBuildSeriesId("3:18:141", "30")).toBe("3:18:141|30");
    expect(chasBuildSeriesId("3:18:141", "50")).toBe("3:18:141|50");
  });
});

const def = (name: string) => {
  const found = chasIndicatorDefinitions.find((d) => d.name === name);
  if (!found) throw new Error(`no CHAS indicator named ${name}`);
  return found;
};

const fetchOf = (name: string) => {
  const capability = def(name).fetch;
  if (!capability) throw new Error(`CHAS indicator ${name} has no fetch capability`);
  return capability;
};

const sourceOfFn = (name: string) => {
  const fn = def(name).sourceOf;
  if (!fn) throw new Error(`CHAS indicator ${name} has no sourceOf`);
  return fn;
};

describe("CHAS fetch capabilities over recorded fixtures (#235)", () => {
  const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
  const replay = () =>
    createHttpClient({
      source: "hud",
      budget: new MemoryBudgetStore(1000),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "replay", dir: FIXTURES },
    });
  const fetchOne = async (
    indicator: string,
    key: string,
    options: { endYear?: number; explicitYears?: boolean } = {},
  ) => {
    const [result] = await fetchOf(indicator)(replay(), [key], {
      apiKey: "test-token",
      ...options,
    });
    return result;
  };

  // St. Joseph County, IN — latest release (fixture 62fbafae…: chas?type=3&stateId=18&entityId=141).
  // A16 (total owner) = 73225, A17 (total renter) = 34245.
  // D4 (owner >30–50%) = 6195, D5 (renter >30–50%) = 7475, D7 (owner >50%) = 4455, D8 (renter >50%) = 7670.
  const COUNTY_A16 = 73225;
  const COUNTY_A17 = 34245;
  const COUNTY_D4 = 6195;
  const COUNTY_D5 = 7475;
  const COUNTY_D7 = 4455;
  const COUNTY_D8 = 7670;
  const round1 = (n: number, d: number) => Math.round((n / d) * 1000) / 10;

  it("renter cost-burdened share, county, level 30 (default)", async () => {
    const result = await fetchOne("cost_burdened_renter_share", "3:18:141|30");
    expect(result.observations).toHaveLength(1);
    const [obs] = result.observations;
    expect(obs?.value).toBe(round1(COUNTY_D5 + COUNTY_D8, COUNTY_A17));
    expect(obs?.value).toBe(44.2);
    expect(obs?.year).toBe("2022");
    expect(obs?.period).toBe("A01");
    expect(obs?.periodName).toBe("CHAS 2018-2022");
    expect(result.notes?.join(" ")).toMatch(/CHAS 2018-2022, special tabulations/);
    expect(result.notes?.join(" ")).toMatch(/denominator is all renter-occupied households/);
  });

  it("renter cost-burdened share, county, level 50 (severe)", async () => {
    const result = await fetchOne("cost_burdened_renter_share", "3:18:141|50");
    expect(result.observations[0]?.value).toBe(round1(COUNTY_D8, COUNTY_A17));
    expect(result.observations[0]?.value).toBe(22.4);
  });

  it("owner cost-burdened share, county, level 30 and 50", async () => {
    const level30 = await fetchOne("cost_burdened_owner_share", "3:18:141|30");
    expect(level30.observations[0]?.value).toBe(round1(COUNTY_D4 + COUNTY_D7, COUNTY_A16));
    expect(level30.observations[0]?.value).toBe(14.5);
    expect(level30.notes?.join(" ")).toMatch(/denominator is all owner-occupied households/);

    const level50 = await fetchOne("cost_burdened_owner_share", "3:18:141|50");
    expect(level50.observations[0]?.value).toBe(round1(COUNTY_D7, COUNTY_A16));
    expect(level50.observations[0]?.value).toBe(6.1);
  });

  it("renter and owner cost-burdened household counts (the shares' numerators)", async () => {
    const renters30 = await fetchOne("cost_burdened_renters", "3:18:141|30");
    expect(renters30.observations[0]?.value).toBe(COUNTY_D5 + COUNTY_D8);
    const renters50 = await fetchOne("cost_burdened_renters", "3:18:141|50");
    expect(renters50.observations[0]?.value).toBe(COUNTY_D8);

    const owners30 = await fetchOne("cost_burdened_owners", "3:18:141|30");
    expect(owners30.observations[0]?.value).toBe(COUNTY_D4 + COUNTY_D7);
    const owners50 = await fetchOne("cost_burdened_owners", "3:18:141|50");
    expect(owners50.observations[0]?.value).toBe(COUNTY_D7);
  });

  // Indiana — latest release (fixture 88f1681…: chas?type=2&stateId=18).
  // A16 = 1860565, A17 = 793030. D4 = 164995, D5 = 162820, D7 = 111430, D8 = 163510.
  it("renter and owner shares for a state", async () => {
    const renter = await fetchOne("cost_burdened_renter_share", "2:18:|30");
    expect(renter.observations[0]?.value).toBe(round1(162820 + 163510, 793030));
    expect(renter.observations[0]?.value).toBe(41.1);

    const owner = await fetchOne("cost_burdened_owner_share", "2:18:|30");
    expect(owner.observations[0]?.value).toBe(round1(164995 + 111430, 1860565));
    expect(owner.observations[0]?.value).toBe(14.9);
  });

  // South Bend city, IN — latest release (fixture cc8337c…: chas?type=5&stateId=18&entityId=71000).
  // A16 = 23730, A17 = 16830. D4 = 2215, D5 = 3685, D7 = 1980, D8 = 4244.
  it("renter and owner shares for a place", async () => {
    const renter = await fetchOne("cost_burdened_renter_share", "5:18:71000|30");
    expect(renter.observations[0]?.value).toBe(round1(3685 + 4244, 16830));
    expect(renter.observations[0]?.value).toBe(47.1);

    const owner = await fetchOne("cost_burdened_owner_share", "5:18:71000|30");
    expect(owner.observations[0]?.value).toBe(round1(2215 + 1980, 23730));
    expect(owner.observations[0]?.value).toBe(17.7);
  });

  // St. Joseph County, IN — explicit endYear 2021 maps to the 2017-2021 release (fixture
  // bc6f1e3…: chas?type=3&stateId=18&entityId=141&year=2017-2021).
  // A16 = 72790, A17 = 33540. D4 = 5945, D5 = 7045, D7 = 4425, D8 = 7095.
  it("an explicit endYear selects the release whose last year matches (2021 -> 2017-2021)", async () => {
    const result = await fetchOne("cost_burdened_renter_share", "3:18:141|30", {
      endYear: 2021,
      explicitYears: true,
    });
    expect(result.observations[0]?.value).toBe(round1(7045 + 7095, 33540));
    expect(result.observations[0]?.value).toBe(42.2);
    expect(result.observations[0]?.year).toBe("2021");
    expect(result.observations[0]?.periodName).toBe("CHAS 2017-2021");
    expect(result.notes?.join(" ")).toMatch(/CHAS 2017-2021/);
  });

  it("sourceOf names the release explicitly, even for the default (latest) call", async () => {
    // The fetch itself reads the bare URL (no year param, fixture 62fbafae…); the citation names
    // the release HUD actually answered with (from the response's own "year" field) so it stays
    // reproducible after HUD publishes a newer one (see chasSourceOf's comment).
    const latest = (await fetchOne("cost_burdened_renter_share", "3:18:141|30")).observations[0];
    const sourceOf = sourceOfFn("cost_burdened_renter_share");
    expect(sourceOf("3:18:141|30", latest)?.url).toBe(
      "https://www.huduser.gov/hudapi/public/chas?type=3&stateId=18&entityId=141&year=2018-2022",
    );

    const explicit = (
      await fetchOne("cost_burdened_renter_share", "3:18:141|30", {
        endYear: 2021,
        explicitYears: true,
      })
    ).observations[0];
    expect(sourceOf("3:18:141|30", explicit)?.url).toBe(
      "https://www.huduser.gov/hudapi/public/chas?type=3&stateId=18&entityId=141&year=2017-2021",
    );
  });

  it("no data (an entity/level HUD returns nothing for) yields no observation and a note, never a guess", async () => {
    // A stub client returning an empty array, the "no data" shape HUD sometimes answers with a 200.
    const emptyClient = { getJson: async () => ({ value: [], cacheHit: false }) } as never;
    const [result] = await fetchOf("cost_burdened_renter_share")(emptyClient, ["3:18:141|30"], {
      apiKey: "test-token",
    });
    expect(result.observations).toHaveLength(0);
    expect(result.notes?.join(" ")).toMatch(/no data published/);
  });
});

describe("hud_get_indicator over CHAS (#235, tool level)", () => {
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

  const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
  const replay = () =>
    createHttpClient({
      source: "hud",
      budget: new MemoryBudgetStore(1000),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "replay", dir: FIXTURES },
    });
  const definition = () =>
    buildHudDefinition({
      catalog,
      httpClient: replay(),
      token: () => "test-token",
      now: () => new Date("2026-09-24"),
    });

  async function callTool(args: Record<string, unknown>) {
    const server = createServer(definition());
    const client = new Client({ name: "chas-test-client", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    try {
      return await client.callTool({ name: "hud_get_indicator", arguments: args });
    } finally {
      await client.close();
    }
  }

  it("renter cost-burdened share for a county (default level 30)", async () => {
    const res = await callTool({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "cost_burdened_renter_share",
    });
    const data = res.structuredContent as {
      data: { latest: { value: number } | null };
      place: { name: string };
    };
    expect(data.data.latest?.value).toBe(44.2);
    expect(data.place.name).toMatch(/St\. Joseph/);
  });

  it("renter cost-burdened share for a city", async () => {
    const res = await callTool({
      place: "South Bend",
      state: "IN",
      kind: "place",
      indicator: "cost_burdened_renter_share",
    });
    const data = res.structuredContent as { data: { latest: { value: number } | null } };
    expect(data.data.latest?.value).toBe(47.1);
  });

  it("renter cost-burdened share for a state", async () => {
    const res = await callTool({
      place: "Indiana",
      kind: "state",
      indicator: "cost_burdened_renter_share",
    });
    const data = res.structuredContent as { data: { latest: { value: number } | null } };
    expect(data.data.latest?.value).toBe(41.1);
  });

  it("owner cost-burdened share for a county", async () => {
    const res = await callTool({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "cost_burdened_owner_share",
    });
    const data = res.structuredContent as { data: { latest: { value: number } | null } };
    expect(data.data.latest?.value).toBe(14.5);
  });

  it("severe cost burden (level 50) for a county", async () => {
    const res = await callTool({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "cost_burdened_renter_share",
      level: "50",
    });
    const data = res.structuredContent as {
      data: { dimensions?: { level?: string }; latest: { value: number } | null };
    };
    expect(data.data.dimensions?.level).toBe("50");
    expect(data.data.latest?.value).toBe(22.4);
  });

  it("household counts (not just shares)", async () => {
    const res = await callTool({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "cost_burdened_renters",
    });
    const data = res.structuredContent as { data: { latest: { value: number } | null } };
    expect(data.data.latest?.value).toBe(15145);
  });

  it("an explicit 2021 release", async () => {
    const res = await callTool({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "cost_burdened_renter_share",
      endYear: 2021,
    });
    const data = res.structuredContent as {
      data: { latest: { value: number } | null };
      limitations?: string[];
    };
    expect(data.data.latest?.value).toBe(42.2);
    expect(data.limitations?.join(" ")).toMatch(/CHAS 2017-2021/);
  });

  it("a metro is unavailable (CHAS has no metro entity, ADR-018 §4)", async () => {
    const res = await callTool({
      place: "South Bend-Mishawaka",
      kind: "metro",
      indicator: "cost_burdened_renter_share",
    });
    const data = res.structuredContent as { data: { status?: string }; limitations?: string[] };
    expect(data.data.status).toBe("unavailable");
    expect(data.limitations?.join(" ")).toMatch(/CHAS publishes no series/);
  });
});

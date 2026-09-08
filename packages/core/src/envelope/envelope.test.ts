import { describe, expect, it } from "vitest";
import { CACHE_MISS } from "../cache.js";
import { envelope } from "./envelope.js";
import { buildCitation, placeRef } from "./types.js";

const source = {
  agency: "bls",
  program: "Local Area Unemployment Statistics",
  ids: ["LAUCN080310000000003"],
  url: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
  citation: "",
};

describe("envelope", () => {
  it("builds an envelope with defaults: empty footnotes/limitations and CACHE_MISS", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    const e = envelope({ data: { rate: 3.1 }, source, now });

    expect(e).toEqual({
      data: { rate: 3.1 },
      source,
      retrievedAt: "2026-09-08T00:00:00.000Z",
      footnotes: [],
      limitations: [],
      cache: CACHE_MISS,
    });
    expect(e.place).toBeUndefined();
    expect(e.vintage).toBeUndefined();
  });

  it("never drops footnotes or limitations passed in", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    const footnotes = [{ code: "P", text: "preliminary", flags: ["preliminary" as const] }];
    const limitations = ["Not seasonally adjusted"];

    const e = envelope({ data: 1, source, footnotes, limitations, now });

    expect(e.footnotes).toEqual(footnotes);
    expect(e.limitations).toEqual(limitations);

    const emptyE = envelope({ data: 1, source, footnotes: [], limitations: [], now });
    expect(emptyE.footnotes).toEqual([]);
    expect(emptyE.limitations).toEqual([]);
  });

  it("carries place, vintage and cache when provided", () => {
    const denver = placeRef({
      geoid: "08031",
      sumlevel: "050",
      label: "County",
      name: "Denver County, Colorado",
    });
    const now = new Date("2026-09-08T00:00:00.000Z");

    const e = envelope({
      data: 1,
      source,
      place: denver,
      vintage: "2025M07",
      cache: { hit: true, ageSeconds: 30 },
      now,
    });

    expect(e.place).toEqual(denver);
    expect(e.vintage).toBe("2025M07");
    expect(e.cache).toEqual({ hit: true, ageSeconds: 30 });
  });

  it("defaults retrievedAt to now when `now` is omitted", () => {
    const before = Date.now();
    const e = envelope({ data: 1, source });
    const after = Date.now();

    const retrievedMs = new Date(e.retrievedAt).getTime();
    expect(retrievedMs).toBeGreaterThanOrEqual(before);
    expect(retrievedMs).toBeLessThanOrEqual(after);
  });

  it("composes with buildCitation for the source", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    const citedSource = { ...source, citation: buildCitation(source, now) };
    const e = envelope({ data: 1, source: citedSource, now });
    expect(e.source.citation).toContain("U.S. Bureau of Labor Statistics");
  });
});

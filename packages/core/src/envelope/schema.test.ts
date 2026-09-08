import { z } from "zod";
import { describe, expect, it } from "vitest";
import { envelope } from "./envelope.js";
import { EnvelopeSchema, envelopeSchema, FootnoteSchema, PlaceRefSchema } from "./schema.js";
import { placeRef } from "./types.js";

const source = {
  agency: "bls",
  program: "Local Area Unemployment Statistics",
  dataset: "LAUS",
  ids: ["LAUCN080310000000003"],
  url: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
  citation: "U.S. Bureau of Labor Statistics, LAUS, series LAUCN080310000000003.",
};

describe("PlaceRefSchema", () => {
  it("validates a Denver County ref with shallow parents", () => {
    const colorado = placeRef({ geoid: "08", sumlevel: "040", label: "State", name: "Colorado" });
    const denver = placeRef({
      geoid: "08031",
      sumlevel: "050",
      label: "County",
      name: "Denver County, Colorado",
      parents: [colorado],
    });

    expect(PlaceRefSchema.parse(denver)).toEqual(denver);
  });
});

describe("FootnoteSchema", () => {
  it("accepts a footnote with known flags", () => {
    expect(
      FootnoteSchema.parse({ code: "P", text: "preliminary", flags: ["preliminary"] }),
    ).toEqual({ code: "P", text: "preliminary", flags: ["preliminary"] });
  });

  it("rejects an unknown flag", () => {
    expect(
      FootnoteSchema.safeParse({ code: "P", text: "preliminary", flags: ["bogus"] }).success,
    ).toBe(false);
  });
});

describe("envelopeSchema round-trip", () => {
  it("round-trips a built envelope through JSON exactly", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    const denver = placeRef({
      geoid: "08031",
      sumlevel: "050",
      label: "County",
      name: "Denver County, Colorado",
    });
    const dataSchema = z.object({ rate: z.number() });

    const e = envelope({
      data: { rate: 3.1 },
      source,
      place: denver,
      vintage: "2025M07",
      footnotes: [{ code: "P", text: "preliminary", flags: ["preliminary"] }],
      limitations: ["Not seasonally adjusted"],
      cache: { hit: true, ageSeconds: 10, stale: false },
      now,
    });

    const roundTripped = envelopeSchema(dataSchema).parse(JSON.parse(JSON.stringify(e)));
    expect(roundTripped).toEqual(e);
  });

  it("round-trips a minimal envelope (no place/vintage) via the permissive EnvelopeSchema", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    const e = envelope({ data: { count: 1 }, source, now });

    const roundTripped = EnvelopeSchema.parse(JSON.parse(JSON.stringify(e)));
    expect(roundTripped).toEqual(e);
  });

  it("rejects an envelope missing a required field", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    const e = envelope({ data: 1, source, now });
    const { source: _dropped, ...broken } = e;
    expect(EnvelopeSchema.safeParse(broken).success).toBe(false);
  });
});

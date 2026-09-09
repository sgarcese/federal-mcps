import { describe, expect, it } from "vitest";
import { buildCitation, EnvelopeSchema, placeRef, type Source } from "../envelope/index.js";
import { MAX_RENDERED_DATA_CHARS, renderText, wrapResult } from "./wrap.js";

const NOW = new Date("2026-09-08T12:00:00.000Z");

const source: Source = {
  agency: "demo",
  program: "Echo",
  ids: ["ECHO-1"],
  url: "https://example.invalid/echo",
  citation: buildCitation(
    { agency: "demo", program: "Echo", ids: ["ECHO-1"], url: "https://example.invalid/echo" },
    NOW,
  ),
};

describe("wrapResult", () => {
  it("builds an envelope in structuredContent and a text rendering in content[0]", () => {
    const wrapped = wrapResult({ data: { value: 4.2 }, source }, NOW);

    expect(EnvelopeSchema.parse(wrapped.structuredContent)).toBeTruthy();
    expect(wrapped.structuredContent.retrievedAt).toBe(NOW.toISOString());
    expect(wrapped.structuredContent.footnotes).toEqual([]);
    expect(wrapped.structuredContent.limitations).toEqual([]);
    expect(wrapped.structuredContent.cache).toEqual({ hit: false });
    expect(wrapped.content).toHaveLength(1);
    expect(wrapped.content[0].type).toBe("text");
    expect(wrapped.content[0].text).toContain('{"value":4.2}');
  });

  it("carries place, vintage, footnotes, limitations and cache through untouched", () => {
    const place = placeRef({ geoid: "08031", sumlevel: "050", label: "county", name: "Denver" });
    const wrapped = wrapResult(
      {
        data: [1],
        source,
        place,
        vintage: "2024",
        footnotes: [{ code: "P", text: "Preliminary.", flags: ["preliminary"] }],
        limitations: ["Not seasonally adjusted."],
        cache: { hit: true, ageSeconds: 30 },
      },
      NOW,
    );

    expect(wrapped.structuredContent.place).toEqual(place);
    expect(wrapped.structuredContent.vintage).toBe("2024");
    expect(wrapped.structuredContent.footnotes).toHaveLength(1);
    expect(wrapped.structuredContent.limitations).toEqual(["Not seasonally adjusted."]);
    expect(wrapped.structuredContent.cache).toEqual({ hit: true, ageSeconds: 30 });
  });
});

describe("renderText", () => {
  it("leads with place, program, ids and retrievedAt, then the data as JSON", () => {
    const place = placeRef({ geoid: "08031", sumlevel: "050", label: "county", name: "Denver" });
    const text = renderText(
      wrapResult({ data: { rate: 3.1 }, source, place }, NOW).structuredContent,
    );
    const lines = text.split("\n");

    expect(lines[0]).toBe("Denver — demo Echo [ECHO-1] — retrieved 2026-09-08T12:00:00.000Z");
    expect(lines[1]).toBe('{"rate":3.1}');
  });

  it("omits the place segment when there is no place, and the ids segment when there are none", () => {
    const text = renderText(
      wrapResult({ data: null, source: { ...source, ids: [] } }, NOW).structuredContent,
    );
    expect(text.split("\n")[0]).toBe("demo Echo — retrieved 2026-09-08T12:00:00.000Z");
  });

  it("truncates long data and says so, leaving structuredContent whole", () => {
    const data = { blob: "x".repeat(MAX_RENDERED_DATA_CHARS * 2) };
    const wrapped = wrapResult({ data, source }, NOW);
    const text = renderText(wrapped.structuredContent);
    const jsonLine = text.split("\n")[1] ?? "";

    expect(jsonLine).toHaveLength(MAX_RENDERED_DATA_CHARS);
    expect(text).toContain("truncated");
    expect(text).toContain("structuredContent");
    expect(wrapped.structuredContent.data).toEqual(data);
  });

  it("renders footnotes and limitations as bullet lines", () => {
    const text = renderText(
      wrapResult(
        {
          data: 1,
          source,
          footnotes: [{ code: "P", text: "Preliminary.", flags: ["preliminary"] }],
          limitations: ["No local CPI for this metro."],
        },
        NOW,
      ).structuredContent,
    );

    expect(text).toContain("- footnote P: Preliminary.");
    expect(text).toContain("- limitation: No local CPI for this metro.");
  });
});

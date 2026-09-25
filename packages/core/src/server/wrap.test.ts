import { describe, expect, it } from "vitest";
import { buildCitation, EnvelopeSchema, envelope, placeRef, type Source } from "../envelope/index.js";
import { MAX_RENDERED_DATA_CHARS, RAW_TEXT_BUDGET, renderText, wrapResult } from "./wrap.js";

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

describe("compact rendering for raw tools (#210, ADR-017)", () => {
  const raw: Source = {
    agency: "demo",
    program: "Raw",
    ids: ["VAR_A", "VAR_B", "VAR_C"],
    url: "https://example.invalid/raw",
    citation: "Demo, Raw. Retrieved 2026-09-08 from https://example.invalid/raw",
  };
  const rows = Array.from({ length: 50 }, (_, i) => `row-${String(i).padStart(2, "0")},${i},${i * 2}`);
  const renderData = () => ({
    head: ["name,a,b"],
    items: rows,
    unit: "rows",
    narrowHint: "Narrow the call: fewer variables or a smaller geography.",
  });

  it("prints the provenance line without the id list, then the head once, then every item that fits", () => {
    const text = renderText(
      envelope({ data: { any: true }, source: raw, now: NOW }),
      { renderData, textBudget: 10_000 },
    );
    const lines = text.split("\n");
    expect(lines[0]).not.toContain("VAR_A");
    expect(lines[0]).toContain("demo Raw");
    expect(lines[1]).toBe("name,a,b");
    expect(text.split("\n").filter((l) => l.startsWith("row-"))).toHaveLength(50);
    expect(text).not.toContain("showing");
  });

  it("cuts on whole items within the budget and says how many were shown and how to narrow", () => {
    const text = renderText(envelope({ data: {}, source: raw, now: NOW }), {
      renderData,
      textBudget: 200,
    });
    const shown = text.split("\n").filter((l) => l.startsWith("row-"));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(50);
    expect(text).toContain(`showing ${shown.length} of 50 rows`);
    expect(text).toContain("structuredContent");
    expect(text).toContain("Narrow the call");
    // no partial row: every printed row is complete
    for (const line of shown) expect(rows).toContain(line);
  });

  it("shows the start of a single item that alone exceeds the budget, marked as partial", () => {
    const big = () => ({ head: [], items: ["x".repeat(500)], unit: "series", narrowHint: "Fewer ids." });
    const text = renderText(envelope({ data: {}, source: raw, now: NOW }), {
      renderData: big,
      textBudget: 100,
    });
    expect(text).toContain("x".repeat(100));
    expect(text).not.toContain("x".repeat(101));
    expect(text).toContain("showing part of 1 of 1 series");
  });

  it("keeps footnotes and limitations after the table", () => {
    const text = renderText(
      envelope({
        data: {},
        source: raw,
        now: NOW,
        limitations: ["a caveat that must travel"],
      }),
      { renderData, textBudget: 200 },
    );
    expect(text.trimEnd().endsWith("- limitation: a caveat that must travel")).toBe(true);
  });

  it("uses the JSON rendering with the given budget when a tool has no renderer", () => {
    const data = { blob: "y".repeat(9000) };
    const text = renderText(envelope({ data, source: raw, now: NOW }), { textBudget: 6000 });
    expect(text).toContain("truncated at 6000 of");
    expect(renderText(envelope({ data, source: raw, now: NOW }))).toContain(
      `truncated at ${MAX_RENDERED_DATA_CHARS} of`,
    );
  });

  it("falls back to JSON when the renderer declines (returns undefined)", () => {
    const text = renderText(envelope({ data: { v: 1 }, source: raw, now: NOW }), {
      renderData: () => undefined,
    });
    expect(text).toContain('{"v":1}');
  });

  it("wrapResult passes the options through and leaves structuredContent whole", () => {
    const wrapped = wrapResult({ data: { rows }, source: raw }, NOW, {
      renderData,
      textBudget: 200,
    });
    expect(wrapped.content[0].text).toContain("showing");
    expect((wrapped.structuredContent.data as { rows: string[] }).rows).toHaveLength(50);
  });

  it("exports the raw budget the rulings set", () => {
    expect(RAW_TEXT_BUDGET).toBe(24_000);
  });
});

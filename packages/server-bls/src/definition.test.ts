import { describe, expect, it } from "vitest";
import { definition } from "./definition.js";

describe("BLS ServerDefinition", () => {
  it("names the server and agency per ADR-001/ADR-004", () => {
    expect(definition.name).toBe("federal-mcps-bls");
    expect(definition.agency).toBe("bls");
    expect(definition.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("ships no tools yet (M1): only the auto-registered describe_source", () => {
    expect(definition.tools).toEqual([]);
  });

  it("drafts instructions from the geography spike's city/county/metro guidance", () => {
    const text = definition.instructions.toLowerCase();
    expect(text).toContain("county");
    expect(text).toContain("metro");
    expect(text).toContain("denver");
    expect(text).toContain("25,000");
    expect(text).toContain("provenance");
  });

  it("keeps instructions to a model-sized paragraph or two", () => {
    const wordCount = definition.instructions.trim().split(/\s+/).length;
    expect(wordCount).toBeGreaterThan(200);
    expect(wordCount).toBeLessThan(600);
  });

  it("exposes describeSource() backing the auto-registered tool", () => {
    expect(typeof definition.describeSource).toBe("function");
    expect(definition.describeSource().agency).toBe("bls");
  });
});

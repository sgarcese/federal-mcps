import { describe, expect, it } from "vitest";
import { CORE_VERSION, FAMILY_VERBS } from "./index.js";

describe("@federal-mcps/core entry point", () => {
  it("exposes the six family verbs from ADR-001 §2, in canonical order", () => {
    expect(FAMILY_VERBS).toEqual([
      "resolve_place",
      "list_indicators",
      "get_indicator",
      "compare_places",
      "get_raw",
      "describe_source",
    ]);
  });

  it("reports a semver-shaped version", () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

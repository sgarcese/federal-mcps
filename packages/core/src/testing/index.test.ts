import { describe, expect, it } from "vitest";
import * as testing from "./index.js";

describe("@federal-mcps/core/testing", () => {
  it("exports the two entry points a server's contract test calls", () => {
    expect(typeof testing.assertFamilyContract).toBe("function");
    expect(typeof testing.assertServerSources).toBe("function");
  });

  it("exports the structured forms and the shared verb table", () => {
    expect(typeof testing.checkFamilyContract).toBe("function");
    expect(typeof testing.checkServerSources).toBe("function");
    expect(testing.FAMILY_VERB_PARAMETERS.get_raw).toEqual(["ids"]);
    expect(testing.CONTRACT_RULES.length).toBeGreaterThan(0);
  });

  it("is reachable from the package's ./testing subpath", async () => {
    const { readFile } = await import("node:fs/promises");
    const manifest: { exports: Record<string, { types: string; default: string }> } = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.exports["./testing"]).toEqual({
      types: "./dist/testing/index.d.ts",
      default: "./dist/testing/index.js",
    });
  });
});

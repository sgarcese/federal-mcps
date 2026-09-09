import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeographyCatalog } from "./catalog.js";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { getContainment, getLineage, getOverlap, resolvePlace } from "./resolver.js";
import type { PlaceCandidate } from "./types.js";

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

function only(result: ReturnType<typeof resolvePlace>): PlaceCandidate {
  expect(result.status).toBe("ok");
  const top = result.candidates[0];
  expect(top).toBeDefined();
  return top as PlaceCandidate;
}

describe("resolvePlace", () => {
  it("stops as ambiguous when a name means several kinds and no kind is given", () => {
    const r = resolvePlace(catalog, "Denver");
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    const kinds = new Set(r.candidates.map((c) => c.kind.sumlevel));
    expect(kinds.has("050")).toBe(true);
    expect(kinds.has("160")).toBe(true);
    expect(kinds.has("310")).toBe(true);
    expect(r.explanation).toMatch(/county|metropolitan|place/);
    expect(r.candidates.every((c) => c.flags.includes("ambiguous"))).toBe(true);
  });

  it("resolves to one kind when the kind hint is given", () => {
    const county = only(resolvePlace(catalog, "Denver", { kind: "county" }));
    expect(county.geoid).toBe("08031");
    expect(county.kind.label).toBe("county");
    const metro = only(resolvePlace(catalog, "Denver", { kind: "metro" }));
    expect(metro.geoid).toBe("19740");
  });

  it("carries every identifier, including UCGID and Data Commons DCID", () => {
    const county = only(resolvePlace(catalog, "Denver", { kind: "county" }));
    expect(county.ucgid).toBe("0500000US08031");
    expect(county.dcid).toBe("geoId/08031");
    const metro = only(resolvePlace(catalog, "Denver", { kind: "metro" }));
    expect(metro.dcid).toBe("geoId/C19740");
  });

  it("flags a below-threshold place and its county fallback", () => {
    const town = only(resolvePlace(catalog, "Smallburg", { kind: "city" }));
    expect(town.flags).toContain("below_threshold");
    expect(town.caveat).toMatch(/25,000/);
    const laus = town.availableAt.find((a) => a.program === "LAUS");
    expect(laus?.hasCode).toBe(false); // falls back to county
  });

  it("flags a CDP, a non-nesting metro, and a recoded county", () => {
    expect(only(resolvePlace(catalog, "Bazville", { kind: "city" })).flags).toContain("cdp");
    expect(only(resolvePlace(catalog, "Denver", { kind: "metro" })).flags).toContain("non_nesting");
    expect(only(resolvePlace(catalog, "Fairfield", { kind: "county" })).flags).toContain(
      "vintage_mismatch",
    );
  });

  it("reports availability with a code present for the county", () => {
    const county = only(resolvePlace(catalog, "Denver", { kind: "county" }));
    const laus = county.availableAt.find((a) => a.program === "LAUS");
    expect(laus?.hasCode).toBe(true);
    expect(county.agencyCodes.some((c) => c.program === "LAUS")).toBe(true);
  });

  it("filters by state", () => {
    expect(
      resolvePlace(catalog, "Denver", { kind: "county", state: "CO" }).candidates,
    ).toHaveLength(1);
    expect(
      resolvePlace(catalog, "Denver", { kind: "county", state: "CA" }).candidates,
    ).toHaveLength(0);
  });
});

describe("containment, overlap, lineage", () => {
  it("returns a place's parents with shares", () => {
    const parents = getContainment(catalog, "0820000");
    expect(parents.map((p) => p.geoid)).toContain("08");
    expect(parents.every((p) => p.share === 1)).toBe(true);
  });

  it("returns a ZCTA's overlapping tracts with allocation shares", () => {
    const tracts = getOverlap(catalog, "80202");
    expect(tracts.map((t) => t.geoid).sort()).toEqual(["08031000101", "08031000102"]);
    const share = tracts.find((t) => t.geoid === "08031000101")?.share;
    expect(share).toBeCloseTo(0.6, 5);
  });

  it("keeps get_containment to the hierarchy — a tract's parents exclude an overlapping ZCTA (#57)", () => {
    const parents = getContainment(catalog, "08031000101");
    expect(parents.map((p) => p.geoid)).not.toContain("80202");
    expect(parents.every((p) => p.relation === "nests")).toBe(true);
    // The ZCTA relationship is areal overlap, surfaced only via getOverlap.
    expect(getOverlap(catalog, "80202").map((t) => t.geoid)).toContain("08031000101");
  });

  it("returns a tract's 2020 successor", () => {
    const lineage = getLineage(catalog, "08031000101");
    expect(lineage).toHaveLength(1);
    expect(lineage[0]).toMatchObject({
      toGeoid: "08031000201",
      fromVintage: 2010,
      toVintage: 2020,
    });
  });
});

describe("query bounds (robustness)", () => {
  it("returns empty for queries shorter than the trigram minimum, without error", () => {
    expect(resolvePlace(catalog, "").candidates).toEqual([]);
    expect(resolvePlace(catalog, "de").candidates).toEqual([]);
  });

  it("bounds an over-long query instead of tokenizing all of it", () => {
    const huge = `Denver${"x".repeat(50_000)}`;
    const r = resolvePlace(catalog, huge, { kind: "county" });
    // "Denver" + padding within the first 200 chars still resolves; it does not hang.
    expect(r.status).toBe("ok");
    expect(r.candidates.length).toBeGreaterThanOrEqual(0);
  });
});

import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { GeographyCatalog } from "./catalog.js";
import { ucgidOf } from "./identifiers.js";
import {
  getAvailability,
  getContainment,
  getLineage,
  getOverlap,
  resolvePlace,
} from "./resolver.js";
import type { PlaceCandidate } from "./types.js";
import { labelForSumlevel } from "./types.js";

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

  it("carries the ACS 5-year population from the catalog, null when unknown (#172)", () => {
    const county = only(resolvePlace(catalog, "Denver", { kind: "county" }));
    expect(county.population).toBe(715_522);
    const metro = only(resolvePlace(catalog, "Denver", { kind: "metro" }));
    expect(metro.population).toBe(3_005_131);
    const west = only(resolvePlace(catalog, "West", { kind: "region" }));
    expect(west.population).toBeNull();
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

describe("same-name places across states (#187)", () => {
  it("stops as ambiguous when exact matches of one kind sit in several states and no state is given", () => {
    const r = resolvePlace(catalog, "Springfield", { kind: "city" });
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    expect(r.explanation).toMatch(/more than one state/);
    expect(r.explanation).toContain("MO");
    expect(r.explanation).toContain("IL");
    expect(r.candidates.every((c) => c.flags.includes("ambiguous"))).toBe(true);
    expect(new Set(r.candidates.map((c) => c.stateFips)).size).toBeGreaterThan(1);
  });

  it("resolves when a state is given", () => {
    expect(only(resolvePlace(catalog, "Springfield", { kind: "city", state: "IL" })).geoid).toBe(
      "1772000",
    );
    expect(only(resolvePlace(catalog, "Springfield", { kind: "city", state: "29" })).geoid).toBe(
      "2970000",
    );
  });

  it("honours a trailing state in the query, as a USPS code or a state name", () => {
    expect(only(resolvePlace(catalog, "Springfield, MO", { kind: "city" })).geoid).toBe("2970000");
    expect(only(resolvePlace(catalog, "Springfield, Illinois", { kind: "city" })).geoid).toBe(
      "1772000",
    );
  });

  it("does not stop when one match dominates the others by population (Denver, CO vs Denver, IA)", () => {
    const r = resolvePlace(catalog, "Denver", { kind: "city" });
    expect(r.status).toBe("ok");
    expect(r.candidates[0]?.geoid).toBe("0820000");
    expect(r.candidates.some((c) => c.geoid === "1920035")).toBe(true);
  });

  it("still stops on kind before state for a bare name", () => {
    const r = resolvePlace(catalog, "Denver");
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    expect(r.explanation).toMatch(/kind/);
  });
});

describe("containment, overlap, lineage", () => {
  it("returns a place's parents with shares", () => {
    const parents = getContainment(catalog, ucgidOf("160", "0820000"));
    expect(parents.map((p) => p.geoid)).toContain("08");
    expect(parents.every((p) => p.share === 1)).toBe(true);
  });

  it("returns a ZCTA's overlapping tracts with allocation shares", () => {
    const tracts = getOverlap(catalog, ucgidOf("860", "80202"));
    expect(tracts.map((t) => t.geoid).sort()).toEqual(["08031000101", "08031000102"]);
    const share = tracts.find((t) => t.geoid === "08031000101")?.share;
    expect(share).toBeCloseTo(0.6, 5);
  });

  it("keeps get_containment to the hierarchy — a tract's parents exclude an overlapping ZCTA (#57)", () => {
    const parents = getContainment(catalog, ucgidOf("140", "08031000101"));
    expect(parents.map((p) => p.geoid)).not.toContain("80202");
    expect(parents.every((p) => p.relation === "nests")).toBe(true);
    // The ZCTA relationship is areal overlap, surfaced only via getOverlap.
    expect(getOverlap(catalog, ucgidOf("860", "80202")).map((t) => t.geoid)).toContain(
      "08031000101",
    );
  });

  it("returns a tract's 2020 successor", () => {
    const lineage = getLineage(catalog, ucgidOf("140", "08031000101"));
    expect(lineage).toHaveLength(1);
    expect(lineage[0]).toMatchObject({
      toGeoid: "08031000201",
      fromVintage: 2010,
      toVintage: 2020,
    });
  });

  it("lists which programs publish for a place's level, with hasCode per program", () => {
    const availability = getAvailability(catalog, ucgidOf("050", "08031")); // Denver County, has a LAUS code
    expect(availability.length).toBeGreaterThan(0);
    const laus = availability.find((a) => a.agency === "bls" && a.program === "LAUS");
    expect(laus).toMatchObject({ sumlevel: "050", hasCode: true });
  });

  it("marks hasCode false when the level publishes but this place has no code", () => {
    const availability = getAvailability(catalog, ucgidOf("160", "0899999")); // Smallburg: below threshold, no LAUS code
    const laus = availability.find((a) => a.agency === "bls" && a.program === "LAUS");
    expect(laus).toMatchObject({ sumlevel: "160", hasCode: false });
  });

  it("returns empty availability for an unknown geoid, without error", () => {
    expect(getAvailability(catalog, ucgidOf("050", "99999999"))).toEqual([]);
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

describe("agency-code notes (#153)", () => {
  it("exposes a code's note on the candidate so a server can carry it as a caveat", () => {
    const codes = catalog.agencyCodesOf(ucgidOf("050", "08031"));
    expect(codes).toContainEqual({
      agency: "bls",
      program: "NOTED",
      code: "X1",
      note: "a caveat that must travel (#153)",
    });
    expect(codes.find((x) => x.program === "LAUS")).not.toHaveProperty("note");
  });
});

describe("Census regions and divisions (#154)", () => {
  it("resolves a division by name and kind, with its region as parent", () => {
    const r = resolvePlace(catalog, "Mountain", { kind: "division" });
    expect(r.candidates[0]).toMatchObject({
      geoid: "8",
      kind: { sumlevel: "030", label: "division" },
    });
    expect(r.candidates[0]?.parents.map((p) => p.name)).toContain("West");
  });

  it("labels regions and divisions", () => {
    expect(labelForSumlevel("020")).toBe("region");
    expect(labelForSumlevel("030")).toBe("division");
  });
});

describe("county subdivisions (#241)", () => {
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

  it("folds a town into its same-municipality city: 'Boston, MA' is one answer, the town named as its parent", () => {
    const r = resolvePlace(catalog, "Boston, MA");
    expect(r.status).toBe("ok");
    expect(r.candidates.map((c) => c.kind.sumlevel)).not.toContain("060");
    expect(r.candidates[0]?.geoid).toBe("2507000");
    expect(r.candidates[0]?.parents).toContainEqual(
      expect.objectContaining({
        geoid: "2502507000",
        kind: { sumlevel: "060", label: "county subdivision" },
      }),
    );
  });

  it("resolves a township that is no place, with or without a kind", () => {
    const r = resolvePlace(catalog, "Smallburg", { kind: "town" });
    expect(r.status).toBe("ok");
    const t = resolvePlace(catalog, "Boston", { kind: "township", state: "NY" });
    expect(t.candidates[0]).toMatchObject({ geoid: "3602907454", kind: { sumlevel: "060" } });
  });

  it("same-name townships in one state, none dominant, ask for the county — never a silent pick ('Cranberry, PA')", () => {
    const r = resolvePlace(catalog, "Cranberry, PA");
    expect(r.status).toBe("ambiguous");
    expect(r.explanation).toMatch(/Butler County/);
    expect(r.explanation).toMatch(/Venango County/);
    expect(r.candidates[0]?.geoid).toBe("4201916920"); // the more populous first
  });

  it("the ambiguity is resolvable: by county in the query, or by GEOID", () => {
    const byCounty = resolvePlace(catalog, "Cranberry, Butler County, PA");
    expect(byCounty.status).toBe("ok");
    expect(byCounty.candidates[0]?.geoid).toBe("4201916920");
    const byGeoid = resolvePlace(catalog, "4212116944");
    expect(byGeoid.status).toBe("ok");
    expect(byGeoid.candidates.map((c) => c.geoid)).toEqual(["4212116944"]);
    expect(resolvePlace(catalog, "Cranberry, PA").explanation).toMatch(
      /Butler County, PA.*4201916920/,
    );
  });

  it("townships never crowd the cities out of the search ('Springfield' with 55 same-name townships)", () => {
    const r = resolvePlace(catalog, "Springfield");
    expect(r.candidates.map((c) => c.geoid)).toEqual(
      expect.arrayContaining(["2970000", "1772000"]),
    );
  });

  it("'town' and 'county subdivision' kinds reach county subdivisions", () => {
    expect(
      resolvePlace(catalog, "Plainfield", { kind: "county subdivision", state: "CT" }).candidates[0]
        ?.geoid,
    ).toBe("0915059980");
    const town = resolvePlace(catalog, "Plainfield", { kind: "town", state: "CT" });
    expect(town.candidates.map((c) => c.geoid)).toContain("0915059980");
  });

  it("a much smaller same-name town elsewhere neither wins nor makes a big city ambiguous ('Boston')", () => {
    const r = resolvePlace(catalog, "Boston");
    expect(r.status).toBe("ok");
    expect(r.candidates[0]?.geoid).toBe("2507000");
    expect(r.candidates.map((c) => c.geoid)).toContain("3602907454"); // still listed, ranked below
  });

  it("an ambiguous name still leads with its cities, not a big rural township ('Springfield')", () => {
    const r = resolvePlace(catalog, "Springfield");
    expect(r.status).toBe("ambiguous");
    expect(r.candidates[0]?.kind.sumlevel).toBe("160");
    expect(r.explanation).toMatch(/place in more than one state/);
  });

  it("a county subdivision with no LAUS series is flagged for the county fallback; one with a series is not", () => {
    const cranberry = resolvePlace(catalog, "Cranberry", { kind: "township", state: "PA" })
      .candidates[0];
    expect(cranberry?.flags).toContain("below_threshold");
    expect(cranberry?.caveat).toMatch(/county subdivision/);
    const plainfield = resolvePlace(catalog, "Plainfield", { kind: "township", state: "CT" })
      .candidates[0];
    expect(plainfield?.flags).not.toContain("below_threshold");
  });

  it("a place outranks an equally matching county subdivision", () => {
    const r = resolvePlace(catalog, "Boston", { kind: "town" });
    expect(r.candidates[0]?.kind.sumlevel).toBe("160");
  });

  it("a town beside a same-name place that is not its twin stays ambiguous, never picked silently", () => {
    const r = resolvePlace(catalog, "Plainfield, CT");
    expect(r.status).toBe("ambiguous");
    expect(r.explanation).toMatch(/county subdivision/);
  });
});

describe("a metro named with its state suffix (#293)", () => {
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

  it("finds the metro when the query ends in its state ('Denver-Aurora-Centennial, CO')", () => {
    const r = resolvePlace(catalog, "Denver-Aurora-Centennial, CO");
    expect(r.candidates.map((c) => c.geoid)).toContain("19740");
  });

  it("finds a multi-state metro by any state in its title ('…, IN')", () => {
    expect(resolvePlace(catalog, "Chicago-Naperville-Elgin, IN").candidates[0]?.geoid).toBe(
      "16980",
    );
    expect(resolvePlace(catalog, "Chicago-Naperville-Elgin, IL").candidates[0]?.geoid).toBe(
      "16980",
    );
  });

  it("an explicit state argument filters metros the same way, and excludes a metro outside it", () => {
    expect(
      resolvePlace(catalog, "Chicago-Naperville-Elgin", { state: "IN" }).candidates[0]?.geoid,
    ).toBe("16980");
    expect(resolvePlace(catalog, "Chicago-Naperville-Elgin", { state: "CO" }).candidates).toEqual(
      [],
    );
  });

  it("a city or county named with its state does not also pull in the metro by alias", () => {
    const r = resolvePlace(catalog, "Denver, CO");
    expect(r.candidates.map((c) => c.kind.sumlevel)).not.toContain("310");
    expect(r.explanation ?? "").not.toMatch(/metro/i);
  });

  it("a metro kind with a state works too", () => {
    const r = resolvePlace(catalog, "Denver-Aurora-Centennial", { kind: "metro", state: "CO" });
    expect(r.candidates[0]?.geoid).toBe("19740");
  });
});

describe("a state dominates much smaller same-name places (#291)", () => {
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

  it("Colorado resolves to the state, Colorado County, TX still listed after it", () => {
    const r = resolvePlace(catalog, "Colorado");
    expect(r.status).toBe("ok");
    expect(r.candidates[0]?.geoid).toBe("08");
    expect(r.candidates.map((c) => c.geoid)).toContain("48089");
  });

  it("New York stays ambiguous: the state is only 2.4× the city (owner ruling)", () => {
    expect(resolvePlace(catalog, "New York").status).toBe("ambiguous");
  });

  it("Utah stays ambiguous: Utah County holds a fifth of the state (owner ruling)", () => {
    expect(resolvePlace(catalog, "Utah").status).toBe("ambiguous");
  });

  it("a kind still picks the dominated place", () => {
    expect(resolvePlace(catalog, "Colorado", { kind: "county" }).candidates[0]?.geoid).toBe(
      "48089",
    );
  });
});

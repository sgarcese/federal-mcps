import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { describeGeoSource } from "./describe-source.js";

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

describe("geography describeGeoSource()", () => {
  it("names the agency for citations", () => {
    const d = describeGeoSource(catalog);
    expect(d.agency).toBe("geo");
    expect(d.agencyName).toContain("Census Bureau");
    expect(d.homepage).toContain("census.gov");
  });

  it("lists the four reference programs, every one available (it is a local file)", () => {
    const d = describeGeoSource(catalog);
    const codes = d.programs.map((p) => p.code).sort();
    expect(codes).toEqual(["CONTAINMENT", "LINEAGE", "OVERLAP", "RESOLVE"]);
    for (const program of d.programs) {
      expect(program.status).toBe("available");
      expect(program.granularity.length).toBeGreaterThan(0);
    }
  });

  it("reports the catalog vintage read from the artifact, and no external rate limit", () => {
    const d = describeGeoSource(catalog);
    expect(d.quota).toContain("test"); // the fixture's vintage
    expect(d.quota.toLowerCase()).toContain("no external api");
  });

  it("caveats ambiguity, ZCTA-is-not-ZIP, and reading structured flags", () => {
    const text = describeGeoSource(catalog).caveats.join(" ").toLowerCase();
    expect(text).toContain("ambiguous");
    expect(text).toContain("zcta");
    expect(text).toContain("below_threshold");
  });

  it("gives a citation format", () => {
    expect(describeGeoSource(catalog).citationFormat.length).toBeGreaterThan(0);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog, catalogMeta, openCatalog } from "./catalog.js";
import type { CatalogRows } from "./types.js";

function emptyRows(): CatalogRows {
  return {
    entities: [],
    aliases: [],
    containment: [],
    agencyCodes: [],
    publishesAt: [],
    countyChange: [],
    lineage: [],
  };
}

const denver: CatalogRows = {
  ...emptyRows(),
  entities: [
    {
      geoid: "08031",
      sumlevel: "050",
      name: "Denver County",
      lsad: "06",
      funcstat: "F",
      stateFips: "08",
      gnis: "0198131",
      lat: 39.76,
      lon: -104.87,
      aland: 396_915_495,
    },
    {
      geoid: "0820000",
      sumlevel: "160",
      name: "Denver city",
      lsad: "25",
      funcstat: "F",
      stateFips: "08",
      gnis: null,
      lat: 39.76,
      lon: -104.88,
      aland: null,
    },
    {
      geoid: "19740",
      sumlevel: "310",
      name: "Denver-Aurora-Centennial, CO",
      lsad: "M1",
      funcstat: null,
      stateFips: null,
      gnis: null,
      lat: null,
      lon: null,
      aland: null,
    },
  ],
  aliases: [
    { geoid: "08031", alias: "Denver", source: "lsad-stripped" },
    { geoid: "0820000", alias: "Denver", source: "lsad-stripped" },
  ],
  agencyCodes: [
    {
      geoid: "19740",
      agency: "bls",
      program: "LAUS",
      code: "MT0819740000000",
      codeVintage: 2023,
      note: null,
    },
  ],
};

let tmp: string | undefined;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe("buildCatalog", () => {
  it("inserts rows and stamps the vintage", () => {
    const db = new BetterSqlite3(":memory:");
    buildCatalog(db, denver, { vintage: "2025" });
    expect((db.prepare("SELECT count(*) c FROM entity").get() as { c: number }).c).toBe(3);
    expect((db.prepare("SELECT count(*) c FROM agency_code").get() as { c: number }).c).toBe(1);
    expect(catalogMeta(db, "vintage")).toBe("2025");
    db.close();
  });

  it("finds Denver by fuzzy substring across names and aliases", () => {
    const db = new BetterSqlite3(":memory:");
    buildCatalog(db, denver, { vintage: "2025" });
    const rows = db
      .prepare("SELECT geoid FROM name_fts WHERE text MATCH ? GROUP BY geoid")
      .all("denver") as { geoid: string }[];
    const geoids = new Set(rows.map((r) => r.geoid));
    expect(geoids.has("08031")).toBe(true);
    expect(geoids.has("0820000")).toBe(true);
    expect(geoids.has("19740")).toBe(true); // matched on its own name
    db.close();
  });

  it("opens a written catalog file read-only", () => {
    tmp = mkdtempSync(join(tmpdir(), "geo-cat-"));
    const path = join(tmp, "geo.sqlite");
    const w = new BetterSqlite3(path);
    buildCatalog(w, denver, { vintage: "2025" });
    w.close();

    const db = openCatalog(path);
    expect(catalogMeta(db, "vintage")).toBe("2025");
    expect(() =>
      db.prepare("INSERT INTO entity (geoid, sumlevel, name) VALUES ('x','040','X')").run(),
    ).toThrow();
    db.close();
  });
});

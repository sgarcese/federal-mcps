import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog, catalogMeta, openCatalog } from "./catalog.js";
import { ucgidOf } from "@federal-mcps/core";
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
      ucgid: ucgidOf("050", "08031"),
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
      ucgid: ucgidOf("160", "0820000"),
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
      ucgid: ucgidOf("310", "19740"),
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
    { ucgid: ucgidOf("050", "08031"), alias: "Denver", source: "lsad-stripped" },
    { ucgid: ucgidOf("160", "0820000"), alias: "Denver", source: "lsad-stripped" },
  ],
  agencyCodes: [
    {
      ucgid: ucgidOf("310", "19740"),
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
      .prepare("SELECT ucgid FROM name_fts WHERE text MATCH ? GROUP BY ucgid")
      .all("denver") as { ucgid: string }[];
    const ucgids = new Set(rows.map((r) => r.ucgid));
    expect(ucgids.has(ucgidOf("050", "08031"))).toBe(true);
    expect(ucgids.has(ucgidOf("160", "0820000"))).toBe(true);
    expect(ucgids.has(ucgidOf("310", "19740"))).toBe(true); // matched on its own name
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
      db
        .prepare(
          "INSERT INTO entity (ucgid, geoid, sumlevel, name) VALUES ('0400000USx','x','040','X')",
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it("ships the file in DELETE journal mode, not WAL, so a read-only open needs no sidecars (#94)", () => {
    // A WAL database can only be opened where SQLite can create its -wal/-shm sidecars,
    // which fails on a read-only filesystem like Lambda's /var/task — even for a readonly
    // open. The built artifact must therefore be a rollback-journal (DELETE) database.
    tmp = mkdtempSync(join(tmpdir(), "geo-cat-"));
    const path = join(tmp, "geo.sqlite");
    const w = new BetterSqlite3(path);
    buildCatalog(w, denver, { vintage: "2025" });
    w.close();

    const db = openCatalog(path);
    const mode = (db.pragma("journal_mode", { simple: true }) as string).toLowerCase();
    db.close();
    expect(mode).toBe("delete");
    expect(mode).not.toBe("wal");
  });

  it("keeps a county and a ZCTA that share a GEOID distinct, keyed by UCGID (#73)", () => {
    const db = new BetterSqlite3(":memory:");
    const collide: CatalogRows = {
      ...emptyRows(),
      entities: [
        {
          ucgid: ucgidOf("050", "06075"),
          geoid: "06075",
          sumlevel: "050",
          name: "San Francisco County",
          lsad: "06",
          funcstat: "F",
          stateFips: "06",
          gnis: null,
          lat: null,
          lon: null,
          aland: null,
        },
        {
          ucgid: ucgidOf("860", "06075"),
          geoid: "06075",
          sumlevel: "860",
          name: "06075",
          lsad: null,
          funcstat: null,
          stateFips: null,
          gnis: null,
          lat: null,
          lon: null,
          aland: null,
        },
      ],
    };
    // Before #73 this threw "UNIQUE constraint failed: entity.geoid".
    buildCatalog(db, collide, { vintage: "2025" });
    expect((db.prepare("SELECT count(*) c FROM entity").get() as { c: number }).c).toBe(2);
    const county = db
      .prepare("SELECT sumlevel FROM entity WHERE ucgid = ?")
      .get(ucgidOf("050", "06075")) as { sumlevel: string };
    const zcta = db
      .prepare("SELECT sumlevel FROM entity WHERE ucgid = ?")
      .get(ucgidOf("860", "06075")) as { sumlevel: string };
    expect(county.sumlevel).toBe("050");
    expect(zcta.sumlevel).toBe("860");
    db.close();
  });
});

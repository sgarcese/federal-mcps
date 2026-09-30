import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { GeographyCatalog } from "./catalog.js";

/**
 * `publishesAt` must tolerate a catalog built before #294 (no `keyed_by` column): a deployed
 * catalog is a release artifact built separately from core, so an older one can still be
 * served. These tests build the `publishes_at` table by hand, at both the old and new shape,
 * rather than going through `buildCatalog` (which always writes the column).
 */
describe("GeographyCatalog.publishesAt", () => {
  it("defaults keyedBy to 'agency' when an old catalog's publishes_at lacks the column (#294)", () => {
    const db = new BetterSqlite3(":memory:");
    db.exec(
      `CREATE TABLE publishes_at (
         agency TEXT NOT NULL, program TEXT NOT NULL, sumlevel TEXT NOT NULL, constraint_note TEXT,
         PRIMARY KEY (agency, program, sumlevel)
       )`,
    );
    db.prepare(
      "INSERT INTO publishes_at (agency, program, sumlevel, constraint_note) VALUES ('bls','LAUS','050',NULL)",
    ).run();
    const catalog = new GeographyCatalog(db);
    expect(catalog.publishesAt("050")).toEqual([
      {
        agency: "bls",
        program: "LAUS",
        sumlevel: "050",
        constraint_note: null,
        keyed_by: "agency",
      },
    ]);
    catalog.close();
  });

  it("reads keyed_by from a catalog that carries the column (#294)", () => {
    const db = new BetterSqlite3(":memory:");
    db.exec(
      `CREATE TABLE publishes_at (
         agency TEXT NOT NULL, program TEXT NOT NULL, sumlevel TEXT NOT NULL, constraint_note TEXT,
         keyed_by TEXT NOT NULL DEFAULT 'agency',
         PRIMARY KEY (agency, program, sumlevel)
       )`,
    );
    db.prepare(
      "INSERT INTO publishes_at (agency, program, sumlevel, constraint_note, keyed_by) VALUES ('bls','QCEW','050',NULL,'census')",
    ).run();
    const catalog = new GeographyCatalog(db);
    expect(catalog.publishesAt("050")).toEqual([
      {
        agency: "bls",
        program: "QCEW",
        sumlevel: "050",
        constraint_note: null,
        keyed_by: "census",
      },
    ]);
    catalog.close();
  });
});

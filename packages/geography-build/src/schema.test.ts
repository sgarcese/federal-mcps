import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSchema, SCHEMA_VERSION } from "./schema.js";

let db: BetterSqlite3.Database;
afterEach(() => db?.close());

describe("createSchema", () => {
  it("creates every catalog table and the FTS5 name index", () => {
    db = new BetterSqlite3(":memory:");
    createSchema(db);
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all() as {
          name: string;
        }[]
      ).map((r) => r.name),
    );
    for (const t of [
      "entity",
      "alias",
      "containment",
      "agency_code",
      "publishes_at",
      "county_change",
      "lineage",
      "catalog_meta",
      "name_fts",
    ]) {
      expect(tables.has(t), `missing table ${t}`).toBe(true);
    }
  });

  it("records the schema version", () => {
    db = new BetterSqlite3(":memory:");
    createSchema(db);
    const v = db.prepare("SELECT value FROM catalog_meta WHERE key = 'schema_version'").get() as {
      value: string;
    };
    expect(v.value).toBe(String(SCHEMA_VERSION));
  });

  it("carries a nullable population and population_vintage column on entity (#172)", () => {
    db = new BetterSqlite3(":memory:");
    createSchema(db);
    db.prepare(
      `INSERT INTO entity (ucgid, geoid, sumlevel, name, population, population_vintage)
       VALUES ('0400000US08', '08', '040', 'Colorado', 5957493, '2024')`,
    ).run();
    db.prepare(
      `INSERT INTO entity (ucgid, geoid, sumlevel, name) VALUES ('0200000US4', '4', '020', 'West')`,
    ).run();
    const colorado = db
      .prepare("SELECT population, population_vintage FROM entity WHERE ucgid = ?")
      .get("0400000US08") as { population: number; population_vintage: string };
    expect(colorado.population).toBe(5957493);
    expect(colorado.population_vintage).toBe("2024");
    const west = db
      .prepare("SELECT population, population_vintage FROM entity WHERE ucgid = ?")
      .get("0200000US4") as { population: number | null; population_vintage: string | null };
    expect(west.population).toBeNull();
    expect(west.population_vintage).toBeNull();
  });

  it("indexes names for trigram fuzzy search", () => {
    db = new BetterSqlite3(":memory:");
    createSchema(db);
    db.prepare("INSERT INTO name_fts (text, ucgid) VALUES ('Denver County', '08031')").run();
    // trigram tokenizer matches substrings of length >= 3, case-insensitively.
    const hit = db.prepare("SELECT ucgid FROM name_fts WHERE text MATCH ?").get("denver") as
      | { ucgid: string }
      | undefined;
    expect(hit?.ucgid).toBe("08031");
  });
});

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

  it("indexes names for trigram fuzzy search", () => {
    db = new BetterSqlite3(":memory:");
    createSchema(db);
    db.prepare("INSERT INTO name_fts (text, geoid) VALUES ('Denver County', '08031')").run();
    // trigram tokenizer matches substrings of length >= 3, case-insensitively.
    const hit = db.prepare("SELECT geoid FROM name_fts WHERE text MATCH ?").get("denver") as
      | { geoid: string }
      | undefined;
    expect(hit?.geoid).toBe("08031");
  });
});

import type { Database } from "better-sqlite3";

/**
 * The catalog schema (geography-catalog spike; ADR-003, ADR-008 §6). One SQLite file,
 * read-only at serve time. Fuzzy name resolution uses an FTS5 table with the `trigram`
 * tokenizer so substring and typo-tolerant matching work without a search service.
 */
export const SCHEMA_VERSION = 1;

const STATEMENTS = [
  `CREATE TABLE entity (
     geoid       TEXT PRIMARY KEY,
     sumlevel    TEXT NOT NULL,
     name        TEXT NOT NULL,
     lsad        TEXT,
     funcstat    TEXT,
     state_fips  TEXT,
     gnis        TEXT,
     lat         REAL,
     lon         REAL,
     aland       INTEGER
   )`,
  `CREATE INDEX entity_sumlevel ON entity (sumlevel)`,
  `CREATE INDEX entity_state ON entity (state_fips)`,

  `CREATE TABLE alias (
     geoid   TEXT NOT NULL,
     alias   TEXT NOT NULL,
     source  TEXT NOT NULL
   )`,
  `CREATE INDEX alias_geoid ON alias (geoid)`,

  `CREATE TABLE containment (
     child_geoid   TEXT NOT NULL,
     parent_geoid  TEXT NOT NULL,
     share         REAL NOT NULL,
     relation      TEXT NOT NULL DEFAULT 'nests',
     PRIMARY KEY (child_geoid, parent_geoid)
   ) WITHOUT ROWID`,
  `CREATE INDEX containment_parent ON containment (parent_geoid, relation)`,
  `CREATE INDEX containment_child_rel ON containment (child_geoid, relation)`,

  `CREATE TABLE agency_code (
     geoid         TEXT NOT NULL,
     agency        TEXT NOT NULL,
     program       TEXT NOT NULL,
     code          TEXT NOT NULL,
     code_vintage  INTEGER,
     note          TEXT
   )`,
  `CREATE INDEX agency_code_geoid ON agency_code (geoid)`,
  `CREATE INDEX agency_code_lookup ON agency_code (agency, program, code)`,

  `CREATE TABLE publishes_at (
     agency          TEXT NOT NULL,
     program         TEXT NOT NULL,
     sumlevel        TEXT NOT NULL,
     constraint_note TEXT,
     PRIMARY KEY (agency, program, sumlevel)
   ) WITHOUT ROWID`,

  `CREATE TABLE county_change (
     old_geoid  TEXT NOT NULL,
     new_geoid  TEXT NOT NULL,
     effective  TEXT NOT NULL,
     kind       TEXT NOT NULL
   )`,

  `CREATE TABLE lineage (
     from_geoid    TEXT NOT NULL,
     to_geoid      TEXT NOT NULL,
     from_vintage  INTEGER NOT NULL,
     to_vintage    INTEGER NOT NULL,
     share         REAL NOT NULL
   )`,
  `CREATE INDEX lineage_from ON lineage (from_geoid)`,

  // Build metadata: one row, the catalog vintage and schema version.
  `CREATE TABLE catalog_meta (
     key    TEXT PRIMARY KEY,
     value  TEXT NOT NULL
   ) WITHOUT ROWID`,

  // Fuzzy name search. One row per name/alias (many per entity), each tagged with its
  // entity's geoid (UNINDEXED = stored but not tokenized). The trigram tokenizer gives
  // substring + typo tolerance at ~30k names without a search service.
  `CREATE VIRTUAL TABLE name_fts USING fts5(text, geoid UNINDEXED, tokenize = 'trigram')`,
];

/** Creates every table, index and the FTS5 name index on a fresh database. */
export function createSchema(db: Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const run = db.transaction(() => {
    for (const sql of STATEMENTS) db.exec(sql);
    db.prepare("INSERT INTO catalog_meta (key, value) VALUES (?, ?)").run(
      "schema_version",
      String(SCHEMA_VERSION),
    );
  });
  run();
}

import type { Database } from "better-sqlite3";

/**
 * The catalog schema (geography-catalog spike; ADR-003, ADR-008 §6). One SQLite file,
 * read-only at serve time. Fuzzy name resolution uses an FTS5 table with the `trigram`
 * tokenizer so substring and typo-tolerant matching work without a search service.
 */
export const SCHEMA_VERSION = 1;

const STATEMENTS = [
  // Entities are keyed by UCGID, not GEOID: a GEOID is not unique across summary levels
  // (county, CBSA and ZCTA GEOIDs are all 5 digits and collide). GEOID + sumlevel remain
  // columns; `geoid` is indexed so a bare geoid resolves to its candidate(s) (#73).
  `CREATE TABLE entity (
     ucgid       TEXT PRIMARY KEY,
     geoid       TEXT NOT NULL,
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
  `CREATE INDEX entity_geoid ON entity (geoid)`,
  `CREATE INDEX entity_sumlevel ON entity (sumlevel)`,
  `CREATE INDEX entity_state ON entity (state_fips)`,

  `CREATE TABLE alias (
     ucgid   TEXT NOT NULL,
     alias   TEXT NOT NULL,
     source  TEXT NOT NULL
   )`,
  `CREATE INDEX alias_ucgid ON alias (ucgid)`,

  `CREATE TABLE containment (
     child_ucgid   TEXT NOT NULL,
     parent_ucgid  TEXT NOT NULL,
     share         REAL NOT NULL,
     relation      TEXT NOT NULL DEFAULT 'nests',
     PRIMARY KEY (child_ucgid, parent_ucgid)
   ) WITHOUT ROWID`,
  `CREATE INDEX containment_parent ON containment (parent_ucgid, relation)`,
  `CREATE INDEX containment_child_rel ON containment (child_ucgid, relation)`,

  `CREATE TABLE agency_code (
     ucgid         TEXT NOT NULL,
     agency        TEXT NOT NULL,
     program       TEXT NOT NULL,
     code          TEXT NOT NULL,
     code_vintage  INTEGER,
     note          TEXT
   )`,
  `CREATE INDEX agency_code_ucgid ON agency_code (ucgid)`,
  `CREATE INDEX agency_code_lookup ON agency_code (agency, program, code)`,

  `CREATE TABLE publishes_at (
     agency          TEXT NOT NULL,
     program         TEXT NOT NULL,
     sumlevel        TEXT NOT NULL,
     constraint_note TEXT,
     PRIMARY KEY (agency, program, sumlevel)
   ) WITHOUT ROWID`,

  `CREATE TABLE county_change (
     old_ucgid  TEXT NOT NULL,
     new_ucgid  TEXT NOT NULL,
     effective  TEXT NOT NULL,
     kind       TEXT NOT NULL
   )`,

  `CREATE TABLE lineage (
     from_ucgid    TEXT NOT NULL,
     to_ucgid      TEXT NOT NULL,
     from_vintage  INTEGER NOT NULL,
     to_vintage    INTEGER NOT NULL,
     share         REAL NOT NULL
   )`,
  `CREATE INDEX lineage_from ON lineage (from_ucgid)`,

  // Build metadata: one row, the catalog vintage and schema version.
  `CREATE TABLE catalog_meta (
     key    TEXT PRIMARY KEY,
     value  TEXT NOT NULL
   ) WITHOUT ROWID`,

  // Fuzzy name search. One row per name/alias (many per entity), each tagged with its
  // entity's geoid (UNINDEXED = stored but not tokenized). The trigram tokenizer gives
  // substring + typo tolerance at ~30k names without a search service.
  `CREATE VIRTUAL TABLE name_fts USING fts5(text, ucgid UNINDEXED, tokenize = 'trigram')`,
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

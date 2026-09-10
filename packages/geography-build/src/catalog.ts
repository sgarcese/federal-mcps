import BetterSqlite3, { type Database } from "better-sqlite3";
import { createSchema } from "./schema.js";
import type { CatalogRows } from "./types.js";

export interface BuildOptions {
  /** The catalog vintage stamped into `catalog_meta` (e.g. "2025"). */
  vintage: string;
}

/**
 * Builds a catalog database in place: creates the schema, inserts every row, and
 * populates the FTS5 name index from entity names and aliases. The caller opens the
 * `Database` (a file path or `:memory:`); this fills it.
 */
export function buildCatalog(db: Database, rows: CatalogRows, options: BuildOptions): void {
  createSchema(db);

  const insertEntity = db.prepare(
    `INSERT INTO entity (ucgid, geoid, sumlevel, name, lsad, funcstat, state_fips, gnis, lat, lon, aland)
     VALUES (@ucgid, @geoid, @sumlevel, @name, @lsad, @funcstat, @stateFips, @gnis, @lat, @lon, @aland)`,
  );
  const insertAlias = db.prepare(
    "INSERT INTO alias (ucgid, alias, source) VALUES (@ucgid, @alias, @source)",
  );
  const insertContainment = db.prepare(
    `INSERT OR IGNORE INTO containment (child_ucgid, parent_ucgid, share, relation)
     VALUES (@childUcgid, @parentUcgid, @share, @relation)`,
  );
  const insertAgencyCode = db.prepare(
    `INSERT INTO agency_code (ucgid, agency, program, code, code_vintage, note)
     VALUES (@ucgid, @agency, @program, @code, @codeVintage, @note)`,
  );
  const insertPublishesAt = db.prepare(
    `INSERT OR REPLACE INTO publishes_at (agency, program, sumlevel, constraint_note)
     VALUES (@agency, @program, @sumlevel, @constraintNote)`,
  );
  const insertCountyChange = db.prepare(
    `INSERT INTO county_change (old_ucgid, new_ucgid, effective, kind)
     VALUES (@oldUcgid, @newUcgid, @effective, @kind)`,
  );
  const insertLineage = db.prepare(
    `INSERT INTO lineage (from_ucgid, to_ucgid, from_vintage, to_vintage, share)
     VALUES (@fromUcgid, @toUcgid, @fromVintage, @toVintage, @share)`,
  );
  // One FTS row per name/alias, tagged with its entity ucgid (its own rowid auto-assigned).
  const insertFts = db.prepare("INSERT INTO name_fts (text, ucgid) VALUES (?, ?)");

  const run = db.transaction(() => {
    for (const e of rows.entities) insertEntity.run(e);
    for (const a of rows.aliases) insertAlias.run(a);
    for (const c of rows.containment)
      insertContainment.run({ ...c, relation: c.relation ?? "nests" });
    for (const a of rows.agencyCodes) insertAgencyCode.run(a);
    for (const p of rows.publishesAt) insertPublishesAt.run(p);
    for (const c of rows.countyChange) insertCountyChange.run(c);
    for (const l of rows.lineage) insertLineage.run(l);

    // Index every entity name and every alias, keyed by ucgid.
    for (const e of rows.entities) insertFts.run(e.name, e.ucgid);
    for (const a of rows.aliases) insertFts.run(a.alias, a.ucgid);

    db.prepare("INSERT INTO catalog_meta (key, value) VALUES ('vintage', ?)").run(options.vintage);
    db.prepare("INSERT INTO catalog_meta (key, value) VALUES ('built_at', ?)").run(
      new Date().toISOString(),
    );
  });
  run();

  // Ship the artifact in a rollback journal mode, not WAL. `createSchema` sets WAL for
  // fast bulk inserts, but a WAL database can only be opened where SQLite can create its
  // -wal/-shm sidecars — which fails on a read-only filesystem like Lambda's /var/task,
  // even for a `readonly` open (#94, ADR-008 §7). Checkpoint and convert to DELETE (a
  // persistent header change) so a read-only open needs no sidecar files. A no-op for
  // `:memory:` databases.
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("journal_mode = DELETE");
}

/** Opens a catalog file read-only for serving (better-sqlite3, ADR-008 §6). */
export function openCatalog(path: string): Database {
  const db = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  return db;
}

/** Reads a `catalog_meta` value (e.g. "vintage", "schema_version"). */
export function catalogMeta(db: Database, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM catalog_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

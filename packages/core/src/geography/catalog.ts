import BetterSqlite3, { type Database } from "better-sqlite3";

/** A row from the `entity` table. */
export interface EntityRecord {
  geoid: string;
  sumlevel: string;
  name: string;
  lsad: string | null;
  funcstat: string | null;
  state_fips: string | null;
  gnis: string | null;
  lat: number | null;
  lon: number | null;
  aland: number | null;
}

/**
 * A read-only handle to the geography catalog (ADR-008 §6). Wraps a better-sqlite3
 * connection opened read-only and exposes the typed queries the resolver needs. The
 * catalog file is the `@rc/geo-catalog` artifact bundled with each server (#58 wires the
 * default path); tests pass an explicit fixture path.
 */
export class GeographyCatalog {
  private readonly db: Database;

  constructor(pathOrDb: string | Database) {
    this.db =
      typeof pathOrDb === "string"
        ? new BetterSqlite3(pathOrDb, { readonly: true, fileMustExist: true })
        : pathOrDb;
    if (typeof pathOrDb === "string") this.db.pragma("query_only = ON");
  }

  /** The catalog vintage stamped at build time (e.g. "2025"). */
  vintage(): string | undefined {
    const row = this.db.prepare("SELECT value FROM catalog_meta WHERE key = 'vintage'").get() as
      | { value: string }
      | undefined;
    return row?.value;
  }

  close(): void {
    this.db.close();
  }

  /**
   * Candidate entities whose name or an alias matches `query` (FTS5 trigram), optionally
   * filtered by state FIPS and/or a set of sumlevels. Returns each entity once.
   */
  searchNames(
    query: string,
    filters: { stateFips?: string; sumlevels?: string[]; limit?: number } = {},
  ): EntityRecord[] {
    const clauses: string[] = ["name_fts MATCH @q"];
    const sumlevelParams: Record<string, string> = {};
    let sumlevelClause = "";
    if (filters.sumlevels && filters.sumlevels.length > 0) {
      const names = filters.sumlevels.map((_, i) => `@sl${i}`);
      sumlevelClause = ` AND e.sumlevel IN (${names.join(",")})`;
      filters.sumlevels.forEach((s, i) => {
        sumlevelParams[`sl${i}`] = s;
      });
    }
    if (filters.stateFips) clauses.push("e.state_fips = @state");
    const params = {
      q: ftsQuery(query),
      ...(filters.stateFips ? { state: filters.stateFips } : {}),
      ...sumlevelParams,
    };
    const limit = filters.limit ?? 50;
    const rows = this.db
      .prepare(
        `SELECT e.* FROM name_fts f JOIN entity e ON e.geoid = f.geoid
         WHERE ${clauses.join(" AND ")}${sumlevelClause}
         GROUP BY e.geoid
         LIMIT ${limit}`,
      )
      .all(params) as EntityRecord[];
    return rows;
  }

  getEntity(geoid: string): EntityRecord | undefined {
    return this.db.prepare("SELECT * FROM entity WHERE geoid = ?").get(geoid) as
      | EntityRecord
      | undefined;
  }

  /** Every alias for an entity (used to detect exact-name matches for ranking). */
  aliasesOf(geoid: string): string[] {
    return (
      this.db.prepare("SELECT alias FROM alias WHERE geoid = ?").all(geoid) as {
        alias: string;
      }[]
    ).map((r) => r.alias);
  }

  /**
   * A place's containment-hierarchy parents (relation "nests"): county → state, place →
   * county/state, with allocation shares. Excludes areal-overlap edges (#57), so a tract's
   * parents do not include an overlapping ZCTA.
   */
  parentsOf(geoid: string): { entity: EntityRecord; share: number }[] {
    const rows = this.db
      .prepare(
        `SELECT c.parent_geoid AS geoid, c.share AS share FROM containment c
         WHERE c.child_geoid = ? AND c.relation = 'nests' ORDER BY c.share DESC`,
      )
      .all(geoid) as { geoid: string; share: number }[];
    return this.attachEntities(rows);
  }

  /** Areal overlaps of an area (relation "overlaps") — e.g. a ZCTA's overlapping tracts. */
  overlapsOf(geoid: string): { entity: EntityRecord; share: number }[] {
    const rows = this.db
      .prepare(
        `SELECT c.child_geoid AS geoid, c.share AS share FROM containment c
         WHERE c.parent_geoid = ? AND c.relation = 'overlaps' ORDER BY c.share DESC`,
      )
      .all(geoid) as { geoid: string; share: number }[];
    return this.attachEntities(rows);
  }

  agencyCodesOf(geoid: string): { agency: string; program: string; code: string }[] {
    return this.db
      .prepare("SELECT agency, program, code FROM agency_code WHERE geoid = ?")
      .all(geoid) as { agency: string; program: string; code: string }[];
  }

  publishesAt(sumlevel: string): {
    agency: string;
    program: string;
    sumlevel: string;
    constraint_note: string | null;
  }[] {
    return this.db
      .prepare(
        "SELECT agency, program, sumlevel, constraint_note FROM publishes_at WHERE sumlevel = ?",
      )
      .all(sumlevel) as {
      agency: string;
      program: string;
      sumlevel: string;
      constraint_note: string | null;
    }[];
  }

  /** Whether a geoid appears on either side of a county_change (drives `vintage_mismatch`). */
  hasCountyChange(geoid: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM county_change WHERE old_geoid = ? OR new_geoid = ? LIMIT 1")
      .get(geoid, geoid);
    return row !== undefined;
  }

  lineageFrom(geoid: string): {
    fromGeoid: string;
    toGeoid: string;
    fromVintage: number;
    toVintage: number;
    share: number;
  }[] {
    return this.db
      .prepare(
        `SELECT from_geoid AS fromGeoid, to_geoid AS toGeoid, from_vintage AS fromVintage,
                to_vintage AS toVintage, share FROM lineage WHERE from_geoid = ? ORDER BY share DESC`,
      )
      .all(geoid) as {
      fromGeoid: string;
      toGeoid: string;
      fromVintage: number;
      toVintage: number;
      share: number;
    }[];
  }

  private attachEntities(
    rows: { geoid: string; share: number }[],
  ): { entity: EntityRecord; share: number }[] {
    const out: { entity: EntityRecord; share: number }[] = [];
    for (const r of rows) {
      const entity = this.getEntity(r.geoid);
      if (entity) out.push({ entity, share: r.share });
    }
    return out;
  }
}

/**
 * Escapes a user query for an FTS5 trigram MATCH: wrap in double quotes so punctuation and
 * spaces are literal, and double any embedded quote. Trigram needs >= 3 chars to match.
 */
function ftsQuery(query: string): string {
  const trimmed = query.trim().replace(/"/g, '""');
  return `"${trimmed}"`;
}

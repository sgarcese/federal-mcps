import BetterSqlite3, { type Database } from "better-sqlite3";

/** A row from the `entity` table. */
export interface EntityRecord {
  ucgid: string;
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
  /** ACS 5-year total population (`B01003_001E`), when known (#172, ADR-014 §6). */
  population: number | null;
  /** The ACS 5-year vintage the population reflects, e.g. "2024" (2020–2024). */
  population_vintage: string | null;
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
        `SELECT e.* FROM name_fts f JOIN entity e ON e.ucgid = f.ucgid
         WHERE ${clauses.join(" AND ")}${sumlevelClause}
         GROUP BY e.ucgid
         LIMIT ${limit}`,
      )
      .all(params) as EntityRecord[];
    return rows;
  }

  getEntity(ucgid: string): EntityRecord | undefined {
    return this.db.prepare("SELECT * FROM entity WHERE ucgid = ?").get(ucgid) as
      | EntityRecord
      | undefined;
  }

  /** Entities sharing a bare GEOID (a county and a ZCTA can collide) — for disambiguation. */
  entitiesByGeoid(geoid: string): EntityRecord[] {
    return this.db.prepare("SELECT * FROM entity WHERE geoid = ?").all(geoid) as EntityRecord[];
  }

  /** Every alias for an entity (used to detect exact-name matches for ranking). */
  aliasesOf(ucgid: string): string[] {
    return (
      this.db.prepare("SELECT alias FROM alias WHERE ucgid = ?").all(ucgid) as {
        alias: string;
      }[]
    ).map((r) => r.alias);
  }

  /**
   * A place's containment-hierarchy parents (relation "nests"): county → state, place →
   * county/state, with allocation shares. Excludes areal-overlap edges (#57), so a tract's
   * parents do not include an overlapping ZCTA.
   */
  parentsOf(ucgid: string): { entity: EntityRecord; share: number }[] {
    const rows = this.db
      .prepare(
        `SELECT c.parent_ucgid AS ucgid, c.share AS share FROM containment c
         WHERE c.child_ucgid = ? AND c.relation = 'nests' ORDER BY c.share DESC`,
      )
      .all(ucgid) as { ucgid: string; share: number }[];
    return this.attachEntities(rows);
  }

  /** Areal overlaps of an area (relation "overlaps") — e.g. a ZCTA's overlapping tracts. */
  overlapsOf(ucgid: string): { entity: EntityRecord; share: number }[] {
    const rows = this.db
      .prepare(
        `SELECT c.child_ucgid AS ucgid, c.share AS share FROM containment c
         WHERE c.parent_ucgid = ? AND c.relation = 'overlaps' ORDER BY c.share DESC`,
      )
      .all(ucgid) as { ucgid: string; share: number }[];
    return this.attachEntities(rows);
  }

  agencyCodesOf(ucgid: string): { agency: string; program: string; code: string; note?: string }[] {
    const rows = this.db
      .prepare("SELECT agency, program, code, note FROM agency_code WHERE ucgid = ?")
      .all(ucgid) as { agency: string; program: string; code: string; note: string | null }[];
    return rows.map(({ note, ...rest }) => (note === null ? rest : { ...rest, note }));
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

  /** Whether a ucgid appears on either side of a county_change (drives `vintage_mismatch`). */
  hasCountyChange(ucgid: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM county_change WHERE old_ucgid = ? OR new_ucgid = ? LIMIT 1")
      .get(ucgid, ucgid);
    return row !== undefined;
  }

  lineageFrom(ucgid: string): {
    fromGeoid: string;
    toGeoid: string;
    fromVintage: number;
    toVintage: number;
    share: number;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT from_ucgid AS fromUcgid, to_ucgid AS toUcgid, from_vintage AS fromVintage,
                to_vintage AS toVintage, share FROM lineage WHERE from_ucgid = ? ORDER BY share DESC`,
      )
      .all(ucgid) as {
      fromUcgid: string;
      toUcgid: string;
      fromVintage: number;
      toVintage: number;
      share: number;
    }[];
    // Lineage is tract→tract; tract GEOIDs are unique, so the output carries the plain geoid.
    return rows.map((r) => ({
      fromGeoid: geoidFromUcgid(r.fromUcgid),
      toGeoid: geoidFromUcgid(r.toUcgid),
      fromVintage: r.fromVintage,
      toVintage: r.toVintage,
      share: r.share,
    }));
  }

  private attachEntities(
    rows: { ucgid: string; share: number }[],
  ): { entity: EntityRecord; share: number }[] {
    const out: { entity: EntityRecord; share: number }[] = [];
    for (const r of rows) {
      const entity = this.getEntity(r.ucgid);
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

/** The GEOID embedded in a UCGID (`<level>0000US<geoid>` → `<geoid>`). */
function geoidFromUcgid(ucgid: string): string {
  const i = ucgid.indexOf("US");
  return i >= 0 ? ucgid.slice(i + 2) : ucgid;
}

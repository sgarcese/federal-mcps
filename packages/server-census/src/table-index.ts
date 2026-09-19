import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * `census_search_tables`'s search over the vendored table index (ADR-014 §7, #175): topic to
 * Census table/group id, so a model can find `B19013` for "median household income" without a
 * runtime call. `loadTableIndex()` opens `data/table-index.json.gz` (see `data/README.md` for
 * how it's generated); `rankTables`/`searchTables` are pure ranking over the rows — no network,
 * no runtime database.
 */
export interface TableIndexRow {
  /** The table/group id, e.g. `B19013`, `S1701`, `DP04`, `P1`. */
  readonly id: string;
  readonly label: string;
  /** Dataset path without vintage, e.g. `acs/acs5/subject`, `dec/pl`. */
  readonly endpoint: string;
  /** Vintages this table appears in for this endpoint, ascending. */
  readonly years: readonly number[];
}

export interface SearchTablesOptions {
  readonly query: string;
  /** Restrict to one dataset path, e.g. `acs/acs5/subject`. */
  readonly endpoint?: string;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 20;

let cached: readonly TableIndexRow[] | undefined;

/** Gunzips and parses the vendored index once; every later call returns the same array. */
export function loadTableIndex(): readonly TableIndexRow[] {
  if (cached === undefined) {
    const path = join(import.meta.dirname, "data", "table-index.json.gz");
    const json = gunzipSync(readFileSync(path)).toString("utf-8");
    cached = JSON.parse(json) as readonly TableIndexRow[];
  }
  return cached;
}

/** Lower-cased word tokens; punctuation and whitespace are separators, empties dropped. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Newest vintage a row appears in, for tie-breaking (rows always carry at least one year). */
function newestYear(row: TableIndexRow): number {
  return Math.max(...row.years);
}

/**
 * Ranks `rows` against `query`. Tiers, best first:
 *
 * 0. exact id match (case-insensitive)
 * 1. id prefix match
 * 2. every query token present in the label (a full topic match)
 * 3. some (but not all) query tokens present in the label
 *
 * Ties within a tier break by newest year, descending. Rows matching no tier are dropped.
 */
export function rankTables(
  rows: readonly TableIndexRow[],
  options: SearchTablesOptions,
): TableIndexRow[] {
  const queryTokens = tokenize(options.query);
  const queryLower = options.query.trim().toLowerCase();
  const limit = options.limit ?? DEFAULT_LIMIT;

  const candidates = options.endpoint
    ? rows.filter((r) => r.endpoint === options.endpoint)
    : rows;

  const scored: { row: TableIndexRow; tier: number }[] = [];
  for (const row of candidates) {
    const idLower = row.id.toLowerCase();
    let tier: number | undefined;
    if (queryLower.length > 0 && idLower === queryLower) {
      tier = 0;
    } else if (queryLower.length > 0 && idLower.startsWith(queryLower)) {
      tier = 1;
    } else if (queryTokens.length > 0) {
      const labelTokens = tokenize(row.label);
      const hits = queryTokens.filter((t) => labelTokens.includes(t)).length;
      if (hits === queryTokens.length) {
        tier = 2;
      } else if (hits > 0) {
        tier = 3;
      }
    }
    if (tier !== undefined) {
      scored.push({ row, tier });
    }
  }

  scored.sort((a, b) => a.tier - b.tier || newestYear(b.row) - newestYear(a.row));
  return scored.slice(0, limit).map((s) => s.row);
}

export interface SearchTablesResult {
  readonly query: string;
  readonly matches: readonly TableIndexRow[];
}

/** `rankTables` over the vendored index. */
export function searchTables(options: SearchTablesOptions): SearchTablesResult {
  return { query: options.query, matches: rankTables(loadTableIndex(), options) };
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ucgidOf } from "@federal-mcps/core";
import {
  type AliasRow,
  buildCatalog,
  type CatalogRows,
  type ContainmentRow,
  type EntityRow,
} from "@federal-mcps/geography-build";
import BetterSqlite3 from "better-sqlite3";

/**
 * The benchmark's `weighted_overlap` items are locked to the **2010** Census ZCTA-to-Tract
 * Relationship File, while the production catalog is 2020-vintage (GATE-RESULTS.md). So the
 * gate builds its own small, 2010-vintage catalog from a committed slice of that file
 * (Suffolk 25025 + Philadelphia 42101 + the benchmark ZCTAs), which reproduces the
 * benchmark's own ground truths (A01–A06). Production is untouched.
 */
export const BENCH_CATALOG_CSV = fileURLToPath(
  new URL("../data/zcta_tract_rel_2010_bench.csv", import.meta.url),
);

interface OverlapRow {
  zcta: string;
  tract: string;
  /** Percent of the ZCTA's population in this tract (the file's ZPOPPCT). */
  zctaPopPct: number;
}

/** Parse the committed 2010 ZCTA↔tract slice (columns: zcta, tract, zcta_pop_pct, poppt). */
export function parseBenchOverlaps(csv: string): OverlapRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  lines.shift(); // header
  const out: OverlapRow[] = [];
  for (const line of lines) {
    const [zcta, tract, pct] = line.split(",");
    if (!zcta || !tract) continue;
    const zctaPopPct = Number.parseFloat(pct ?? "0");
    out.push({ zcta, tract, zctaPopPct: Number.isFinite(zctaPopPct) ? zctaPopPct : 0 });
  }
  return out;
}

/** Turn the parsed rows into catalog rows: ZCTA + tract entities and their overlap edges. */
export function benchCatalogRows(rows: readonly OverlapRow[]): CatalogRows {
  const entities = new Map<string, EntityRow>();
  const addEntity = (geoid: string, sumlevel: string, name: string): void => {
    const ucgid = ucgidOf(sumlevel, geoid);
    if (!entities.has(ucgid)) {
      entities.set(ucgid, {
        ucgid,
        geoid,
        sumlevel,
        name,
        lsad: null,
        funcstat: null,
        stateFips: sumlevel === "140" ? geoid.slice(0, 2) : null,
        gnis: null,
        lat: null,
        lon: null,
        aland: null,
      });
    }
  };

  const containment: ContainmentRow[] = [];
  for (const r of rows) {
    addEntity(r.zcta, "860", r.zcta);
    addEntity(r.tract, "140", `Census Tract ${r.tract}`);
    containment.push({
      childUcgid: ucgidOf("140", r.tract),
      parentUcgid: ucgidOf("860", r.zcta),
      share: r.zctaPopPct / 100,
      relation: "overlaps",
    });
  }

  return {
    entities: [...entities.values()],
    aliases: [] as AliasRow[],
    containment,
    agencyCodes: [],
    publishesAt: [],
    countyChange: [],
    lineage: [],
  };
}

/** Build the 2010 gate catalog into a SQLite file (default `:memory:` → a temp path). */
export function buildBenchCatalog(outPath: string): string {
  const rows = benchCatalogRows(parseBenchOverlaps(readFileSync(BENCH_CATALOG_CSV, "utf-8")));
  const db = new BetterSqlite3(outPath);
  buildCatalog(db, rows, { vintage: "2010-bench" });
  db.close();
  return outPath;
}

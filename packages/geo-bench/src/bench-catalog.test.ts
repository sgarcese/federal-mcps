import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GeographyCatalog, getOverlap, ucgidOf } from "@federal-mcps/core";
import BetterSqlite3 from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBenchCatalog } from "./bench-catalog.js";

let dir: string;
let path: string;
let catalog: GeographyCatalog;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bench-cat-"));
  path = buildBenchCatalog(join(dir, "bench.sqlite"));
  catalog = new GeographyCatalog(path);
});
afterAll(() => {
  catalog.close();
  rmSync(dir, { recursive: true, force: true });
});

const zctaOverlap = (zcta: string) => getOverlap(catalog, ucgidOf("860", zcta));

describe("the 2010 gate catalog reproduces UGEO-Bench weighted_overlap (A01–A06)", () => {
  it("A01: ZCTA 19104 overlaps 17 distinct 2010 tracts", () => {
    expect(zctaOverlap("19104").length).toBe(17);
  });

  it("A02: ZCTA 02134 overlaps 9 distinct 2010 tracts", () => {
    expect(zctaOverlap("02134").length).toBe(9);
  });

  it("A03: 69.86% of ZCTA 02108's population is in tract 25025020101", () => {
    const edge = zctaOverlap("02108").find((e) => e.geoid === "25025020101");
    expect(edge?.share).toBeCloseTo(0.6986, 3);
  });

  it("A04: tract 25025000802 holds the largest share (33.76%) of ZCTA 02134", () => {
    const top = zctaOverlap("02134").reduce((a, b) => (b.share > a.share ? b : a));
    expect(top.geoid).toBe("25025000802");
    expect(top.share).toBeCloseTo(0.3376, 3);
  });

  it("A05: ZCTA 02215 spans Suffolk (25025) and Middlesex (25021) — not one county", () => {
    const counties = new Set(zctaOverlap("02215").map((e) => e.geoid.slice(0, 5)));
    expect(counties.size).toBe(2);
    expect(counties.has("25025")).toBe(true);
    expect(counties.has("25021")).toBe(true);
  });

  it("A06: 237 of 586 tracts in Suffolk+Philadelphia are overlapped by more than one ZCTA", () => {
    const db = new BetterSqlite3(path, { readonly: true });
    // Tracts (by geoid prefix = county) with more than one distinct overlapping ZCTA parent.
    const row = db
      .prepare(
        `SELECT
           count(*) total,
           sum(CASE WHEN n > 1 THEN 1 ELSE 0 END) multi
         FROM (
           SELECT e.geoid, count(DISTINCT c.parent_ucgid) n
           FROM entity e
           JOIN containment c ON c.child_ucgid = e.ucgid AND c.relation = 'overlaps'
           WHERE e.sumlevel = '140'
             AND (substr(e.geoid, 1, 5) = '25025' OR substr(e.geoid, 1, 5) = '42101')
           GROUP BY e.ucgid
         )`,
      )
      .get() as { total: number; multi: number };
    db.close();
    expect(row.total).toBe(586);
    expect(row.multi).toBe(237);
  });
});

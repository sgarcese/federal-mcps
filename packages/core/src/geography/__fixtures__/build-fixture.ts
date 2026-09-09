import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { buildCatalog } from "@federal-mcps/geography-build";
import type {
  AgencyCodeRow,
  CatalogRows,
  ContainmentRow,
  EntityRow,
} from "@federal-mcps/geography-build";

/**
 * Builds a tiny catalog file for resolver tests: Denver at three levels (a genuine
 * ambiguity), a below-threshold town, a CDP, a Connecticut county that was recoded, a
 * ZCTA overlapping two tracts, and one tract with a 2020 successor.
 */
export function buildFixtureCatalog(): string {
  const entities: EntityRow[] = [
    ent("08", "040", "Colorado", { stateFips: "08", aland: 268_431_000_000 }),
    ent("08031", "050", "Denver County", { stateFips: "08", lsad: "06", aland: 396_915_495 }),
    ent("0820000", "160", "Denver city", { stateFips: "08", lsad: "25", aland: 396_000_000 }),
    ent("19740", "310", "Denver-Aurora-Centennial, CO", { lsad: "M1" }),
    ent("0899999", "160", "Smallburg town", { stateFips: "08", lsad: "43", aland: 5_000_000 }),
    ent("0888888", "160", "Bazville CDP", { stateFips: "08", lsad: "57", aland: 2_000_000 }),
    ent("09001", "050", "Fairfield County", { stateFips: "09", lsad: "06", aland: 1_618_000_000 }),
    ent("80202", "860", "80202", {}),
    ent("08031000101", "140", "Census Tract 101", { stateFips: "08" }),
    ent("08031000102", "140", "Census Tract 102", { stateFips: "08" }),
  ];

  const aliases = [
    { geoid: "08031", alias: "Denver", source: "lsad-stripped" },
    { geoid: "0820000", alias: "Denver", source: "lsad-stripped" },
    { geoid: "19740", alias: "Denver", source: "hand" }, // makes the metro a strong match too
    { geoid: "0899999", alias: "Smallburg", source: "lsad-stripped" },
    { geoid: "0888888", alias: "Bazville", source: "lsad-stripped" },
    { geoid: "09001", alias: "Fairfield", source: "lsad-stripped" },
  ];

  const containment: ContainmentRow[] = [
    { childGeoid: "08031", parentGeoid: "08", share: 1 },
    { childGeoid: "0820000", parentGeoid: "08", share: 1 },
    { childGeoid: "08031000101", parentGeoid: "80202", share: 0.6, relation: "overlaps" },
    { childGeoid: "08031000102", parentGeoid: "80202", share: 0.4, relation: "overlaps" },
  ];

  const agencyCodes: AgencyCodeRow[] = [
    code("08031", "LAUS", "LAUCN0803100000000"),
    code("0820000", "LAUS", "LAUCT0820000000000"), // the city is above threshold
    code("19740", "LAUS", "LAUMT0819740000000"),
    // Smallburg (0899999) and Bazville (0888888) have NO LAUS code → below_threshold.
  ];

  const rows: CatalogRows = {
    entities,
    aliases,
    containment,
    agencyCodes,
    publishesAt: [
      { agency: "bls", program: "LAUS", sumlevel: "050", constraintNote: null },
      { agency: "bls", program: "LAUS", sumlevel: "310", constraintNote: null },
      {
        agency: "bls",
        program: "LAUS",
        sumlevel: "160",
        constraintNote: "incorporated place, population >= 25000",
      },
    ],
    countyChange: [
      { oldGeoid: "09001", newGeoid: "09110", effective: "2022-06-01", kind: "recode" },
    ],
    lineage: [
      {
        fromGeoid: "08031000101",
        toGeoid: "08031000201",
        fromVintage: 2010,
        toVintage: 2020,
        share: 1,
      },
    ],
  };

  const dir = mkdtempSync(join(tmpdir(), "geo-fixture-"));
  const path = join(dir, "geo.sqlite");
  const db = new BetterSqlite3(path);
  buildCatalog(db, rows, { vintage: "test" });
  db.close();
  return path;
}

function ent(geoid: string, sumlevel: string, name: string, extra: Partial<EntityRow>): EntityRow {
  return {
    geoid,
    sumlevel,
    name,
    lsad: null,
    funcstat: null,
    stateFips: null,
    gnis: null,
    lat: null,
    lon: null,
    aland: null,
    ...extra,
  };
}

function code(geoid: string, program: string, value: string): AgencyCodeRow {
  return { geoid, agency: "bls", program, code: value, codeVintage: 2023, note: null };
}

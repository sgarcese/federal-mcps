import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgencyCodeRow,
  buildCatalog,
  type CatalogRows,
  type ContainmentRow,
  type EntityRow,
} from "@federal-mcps/geography-build";
import BetterSqlite3 from "better-sqlite3";

/**
 * A tiny geography catalog file for the server-geo suite: Denver at three levels (a real
 * ambiguity), a below-threshold town, a ZCTA overlapping two tracts, one tract with a 2020
 * successor, and LAUS publish levels — enough to exercise every geo tool end to end. Mirrors
 * core's resolver fixture; kept local so the server package's tests own their own data.
 */
export function buildFixtureCatalog(): string {
  const entities: EntityRow[] = [
    ent("08", "040", "Colorado", { stateFips: "08", aland: 268_431_000_000 }),
    ent("08031", "050", "Denver County", { stateFips: "08", lsad: "06", aland: 396_915_495 }),
    ent("0820000", "160", "Denver city", { stateFips: "08", lsad: "25", aland: 396_000_000 }),
    ent("19740", "310", "Denver-Aurora-Centennial, CO", { lsad: "M1" }),
    ent("0899999", "160", "Smallburg town", { stateFips: "08", lsad: "43", aland: 5_000_000 }),
    ent("80202", "860", "80202", {}),
    ent("08031000101", "140", "Census Tract 101", { stateFips: "08" }),
    ent("08031000102", "140", "Census Tract 102", { stateFips: "08" }),
  ];

  const aliases = [
    { geoid: "08031", alias: "Denver", source: "lsad-stripped" },
    { geoid: "0820000", alias: "Denver", source: "lsad-stripped" },
    { geoid: "19740", alias: "Denver", source: "hand" },
    { geoid: "0899999", alias: "Smallburg", source: "lsad-stripped" },
  ];

  const containment: ContainmentRow[] = [
    { childGeoid: "08031", parentGeoid: "08", share: 1 },
    { childGeoid: "0820000", parentGeoid: "08", share: 1 },
    { childGeoid: "08031000101", parentGeoid: "80202", share: 0.6, relation: "overlaps" },
    { childGeoid: "08031000102", parentGeoid: "80202", share: 0.4, relation: "overlaps" },
  ];

  const agencyCodes: AgencyCodeRow[] = [
    code("08031", "LAUS", "LAUCN0803100000000"),
    code("0820000", "LAUS", "LAUCT0820000000000"),
    code("19740", "LAUS", "LAUMT0819740000000"),
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
    countyChange: [],
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

  const dir = mkdtempSync(join(tmpdir(), "geo-server-fixture-"));
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

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
import { ucgidOf } from "@federal-mcps/core";

/**
 * A tiny geography catalog for the server-geo suite: Denver at three levels (a genuine
 * ambiguity), a below-threshold town, a CDP, a Connecticut county that was recoded, a
 * ZCTA overlapping two tracts, and one tract with a 2020 successor. Entities are keyed by
 * UCGID (#73); the helpers below author by (geoid, level) and derive the UCGID.
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
  // In this fixture every referenced geoid is a distinct entity, so a geoid → ucgid map is
  // unambiguous (the collision #73 addresses only appears at national scale).
  const uc = (geoid: string): string => {
    const e = entities.find((x) => x.geoid === geoid);
    if (!e) throw new Error(`fixture: no entity for geoid ${geoid}`);
    return e.ucgid;
  };

  const aliases = [
    { ucgid: uc("08031"), alias: "Denver", source: "lsad-stripped" },
    { ucgid: uc("0820000"), alias: "Denver", source: "lsad-stripped" },
    { ucgid: uc("19740"), alias: "Denver", source: "hand" }, // the metro is a strong match too
    { ucgid: uc("0899999"), alias: "Smallburg", source: "lsad-stripped" },
    { ucgid: uc("0888888"), alias: "Bazville", source: "lsad-stripped" },
    { ucgid: uc("09001"), alias: "Fairfield", source: "lsad-stripped" },
  ];

  const containment: ContainmentRow[] = [
    { childUcgid: uc("08031"), parentUcgid: uc("08"), share: 1 },
    { childUcgid: uc("0820000"), parentUcgid: uc("08"), share: 1 },
    { childUcgid: uc("08031000101"), parentUcgid: uc("80202"), share: 0.6, relation: "overlaps" },
    { childUcgid: uc("08031000102"), parentUcgid: uc("80202"), share: 0.4, relation: "overlaps" },
  ];

  const agencyCodes: AgencyCodeRow[] = [
    code(uc("08031"), "LAUS", "CN0803100000000"),
    code(uc("0820000"), "LAUS", "CT0820000000000"), // the city is above threshold
    code(uc("19740"), "LAUS", "MT0819740000000"),
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
      {
        oldUcgid: ucgidOf("050", "09001"),
        newUcgid: ucgidOf("050", "09110"),
        effective: "2022-06-01",
        kind: "recode",
      },
    ],
    lineage: [
      {
        fromUcgid: ucgidOf("140", "08031000101"),
        toUcgid: ucgidOf("140", "08031000201"),
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
    ucgid: ucgidOf(sumlevel, geoid),
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

function code(ucgid: string, program: string, value: string): AgencyCodeRow {
  return { ucgid, agency: "bls", program, code: value, codeVintage: 2023, note: null };
}

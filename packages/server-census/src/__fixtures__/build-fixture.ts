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
 * A tiny geography catalog for the server-bls suite: Denver at three levels (a genuine
 * ambiguity), a below-threshold town, a CDP, a Connecticut county that was recoded, a
 * ZCTA overlapping two tracts, and one tract with a 2020 successor. Entities are keyed by
 * UCGID (#73); the helpers below author by (geoid, level) and derive the UCGID.
 */
export function buildFixtureCatalog(): string {
  const entities: EntityRow[] = [
    ent("4", "020", "West", {}), // Census region (#154) — no ACS population column (#172)
    ent("8", "030", "Mountain", {}), // Census division with a CPI code (#154)
    ent("9", "030", "Pacific", {}), // Census division WITHOUT a CPI code in this fixture (#154)
    ent("53", "040", "Washington", {
      stateFips: "53",
      aland: 172_000_000_000,
      population: 7_958_180,
      populationVintage: "2024",
    }),
    ent("08", "040", "Colorado", {
      stateFips: "08",
      aland: 268_431_000_000,
      population: 5_957_493,
      populationVintage: "2024",
    }),
    ent("08031", "050", "Denver County", {
      stateFips: "08",
      lsad: "06",
      aland: 396_915_495,
      population: 715_522,
      populationVintage: "2024",
    }),
    ent("0820000", "160", "Denver city", {
      stateFips: "08",
      lsad: "25",
      aland: 396_000_000,
      population: 729_019,
      populationVintage: "2024",
    }),
    ent("19740", "310", "Denver-Aurora-Centennial, CO", {
      lsad: "M1",
      population: 3_005_131,
      populationVintage: "2024",
    }),
    ent("16980", "310", "Chicago-Naperville-Elgin, IL-IN-WI", { lsad: "M1" }), // multi-state (#153); no population in this fixture (#172)
    // Below-threshold city with recorded ACS fixtures (M8.4): Sedona, AZ, and its state.
    ent("04", "040", "Arizona", {
      stateFips: "04",
      aland: 294_000_000_000,
      population: 7_431_344,
      populationVintage: "2024",
    }),
    ent("0465350", "160", "Sedona city", {
      stateFips: "04",
      lsad: "25",
      aland: 49_000_000,
      population: 9_777,
      populationVintage: "2024",
    }),
    // Denver County tracts with recorded fixtures: an uncomputable median and a low-reliability one.
    ent("08031980001", "140", "Census Tract 9800.01", { stateFips: "08", aland: 1_000_000 }),
    ent("08031000503", "140", "Census Tract 5.03", { stateFips: "08", aland: 1_000_000 }),
    ent("0899999", "160", "Smallburg town", {
      stateFips: "08",
      lsad: "43",
      aland: 5_000_000,
      population: 4_000,
      populationVintage: "2024",
    }),
    ent("0888888", "160", "Bazville CDP", {
      stateFips: "08",
      lsad: "57",
      aland: 2_000_000,
      population: 1_500,
      populationVintage: "2024",
    }),
    ent("09001", "050", "Fairfield County", {
      stateFips: "09",
      lsad: "06",
      aland: 1_618_000_000,
      population: 959_768,
      populationVintage: "2024",
    }),
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
    { ucgid: uc("16980"), alias: "Chicago", source: "hand" },
    { ucgid: uc("0899999"), alias: "Smallburg", source: "lsad-stripped" },
    { ucgid: uc("0465350"), alias: "Sedona", source: "lsad-stripped" },
    { ucgid: uc("0888888"), alias: "Bazville", source: "lsad-stripped" },
    { ucgid: uc("09001"), alias: "Fairfield", source: "lsad-stripped" },
  ];

  const containment: ContainmentRow[] = [
    { childUcgid: uc("08"), parentUcgid: uc("8"), share: 1 }, // Colorado → Mountain (#154)
    { childUcgid: uc("53"), parentUcgid: uc("9"), share: 1 }, // Washington → Pacific
    { childUcgid: uc("8"), parentUcgid: uc("4"), share: 1 },
    { childUcgid: uc("9"), parentUcgid: uc("4"), share: 1 },
    { childUcgid: uc("08031"), parentUcgid: uc("08"), share: 1 },
    { childUcgid: uc("0820000"), parentUcgid: uc("08"), share: 1 },
    { childUcgid: uc("0899999"), parentUcgid: uc("08031"), share: 1 }, // town nests in its county
    { childUcgid: uc("0465350"), parentUcgid: uc("04"), share: 1 },
    { childUcgid: uc("08031980001"), parentUcgid: uc("08031"), share: 1 },
    { childUcgid: uc("08031000503"), parentUcgid: uc("08031"), share: 1 },
    { childUcgid: uc("08031000101"), parentUcgid: uc("80202"), share: 0.6, relation: "overlaps" },
    { childUcgid: uc("08031000102"), parentUcgid: uc("80202"), share: 0.4, relation: "overlaps" },
  ];

  const agencyCodes: AgencyCodeRow[] = [
    code(uc("08031"), "LAUS", "CN0803100000000"),
    code(uc("0820000"), "LAUS", "CT0820000000000"), // the city is above threshold
    code(uc("19740"), "LAUS", "MT0819740000000"),
    code(uc("19740"), "CPI", "S48B"), // Denver is one of the ~23 published CPI metros
    code(uc("8"), "CPI", "0480"), // Mountain division CPI (#154)
    code(uc("4"), "CPI", "0400"), // West region CPI (#154)
    code(uc("19740"), "SM", "0819740"), // CES metro key: state 08 + CBSA 19740 (#110)
    code(uc("19740"), "QCEW", "C1974"), // QCEW metro C-code (#153)
    {
      ...code(uc("16980"), "SM", "1716980"), // multi-state metro filed under IL (#153)
      note: "CES publishes this multi-state metro as one series under Illinois (IL).",
    },
    code(uc("19740"), "OEWS", "0019740"), // OEWS metro area code: "00" + CBSA 19740 (#152)
    code(uc("09001"), "LAUS", "CN0900100000000"), // Fairfield County CT, for compare_places

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

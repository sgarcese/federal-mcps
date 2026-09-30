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
import { ucgidOf } from "../identifiers.js";

/**
 * Builds a tiny catalog file for resolver tests: Denver at three levels (a genuine
 * ambiguity), a below-threshold town, a CDP, a Connecticut county that was recoded, a
 * ZCTA overlapping two tracts, and one tract with a 2020 successor. Entities are keyed by
 * UCGID (#73); the helpers below author by (geoid, level) and derive the UCGID.
 */
export function buildFixtureCatalog(): string {
  const entities: EntityRow[] = [
    ent("4", "020", "West", {}), // Census region (#154) — no ACS population column (#172)
    ent("8", "030", "Mountain", {}), // Census division (#154) — no ACS population column (#172)
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
    // Same-name places across states (#187): two comparable Springfields, and a tiny
    // Denver city in Iowa that Denver, CO dominates by population.
    ent("29", "040", "Missouri", {
      stateFips: "29",
      population: 6_200_000,
      populationVintage: "2024",
    }),
    ent("17", "040", "Illinois", {
      stateFips: "17",
      population: 12_600_000,
      populationVintage: "2024",
    }),
    ent("2970000", "160", "Springfield city", {
      stateFips: "29",
      lsad: "25",
      aland: 215_000_000,
      population: 169_000,
      populationVintage: "2024",
    }),
    ent("1772000", "160", "Springfield city", {
      stateFips: "17",
      lsad: "25",
      aland: 170_000_000,
      population: 114_000,
      populationVintage: "2024",
    }),
    ent("1920035", "160", "Denver city", {
      stateFips: "19",
      lsad: "25",
      aland: 4_000_000,
      population: 1_800,
      populationVintage: "2024",
    }),
    // County subdivisions (#241): Boston's town twin (same code), a Pennsylvania township with
    // no place, and a Connecticut town beside a same-name CDP that is NOT its twin.
    ent("25", "040", "Massachusetts", {
      stateFips: "25",
      population: 7_000_000,
      populationVintage: "2024",
    }),
    ent("25025", "050", "Suffolk County", {
      stateFips: "25",
      lsad: "06",
      aland: 150_000_000,
      population: 770_000,
      populationVintage: "2024",
    }),
    ent("2507000", "160", "Boston city", {
      stateFips: "25",
      lsad: "25",
      aland: 125_000_000,
      population: 663_972,
      populationVintage: "2024",
    }),
    ent("2502507000", "060", "Boston city", {
      stateFips: "25",
      funcstat: "A",
      aland: 125_000_000,
      population: 663_972,
      populationVintage: "2024",
    }),
    ent("42", "040", "Pennsylvania", {
      stateFips: "42",
      population: 13_000_000,
      populationVintage: "2024",
    }),
    ent("42019", "050", "Butler County", {
      stateFips: "42",
      lsad: "06",
      aland: 2_042_000_000,
      population: 198_000,
      populationVintage: "2024",
    }),
    ent("4201916920", "060", "Cranberry township", {
      stateFips: "42",
      funcstat: "A",
      aland: 59_000_000,
      population: 33_000,
      populationVintage: "2024",
    }),
    ent("09", "040", "Connecticut", {
      stateFips: "09",
      population: 3_600_000,
      populationVintage: "2024",
    }),
    ent("0960120", "160", "Plainfield CDP", {
      stateFips: "09",
      lsad: "57",
      aland: 8_000_000,
      population: 2_700,
      populationVintage: "2024",
    }),
    ent("0915059980", "060", "Plainfield town", {
      stateFips: "09",
      funcstat: "A",
      aland: 110_000_000,
      population: 15_000,
      populationVintage: "2024",
    }),
    // A small same-name town elsewhere (Boston, NY): dominated, never a reason to ask (#241).
    ent("36", "040", "New York", {
      stateFips: "36",
      population: 19_800_000,
      populationVintage: "2024",
    }),
    ent("3602907454", "060", "Boston town", {
      stateFips: "36",
      funcstat: "A",
      aland: 111_000_000,
      population: 7_948,
      populationVintage: "2024",
    }),
    // A big rural township sharing Springfield's name: more land, far fewer people (#241).
    ent("2907770009", "060", "Springfield township", {
      stateFips: "29",
      funcstat: "A",
      aland: 3_000_000_000,
      population: 3_000,
      populationVintage: "2024",
    }),
    // A second Cranberry township in Pennsylvania, comparable in size: a same-state rival (#241).
    ent("42121", "050", "Venango County", {
      stateFips: "42",
      lsad: "06",
      aland: 1_750_000_000,
      population: 50_000,
      populationVintage: "2024",
    }),
    ent("4212116944", "060", "Cranberry township", {
      stateFips: "42",
      funcstat: "A",
      aland: 150_000_000,
      population: 6_273,
      populationVintage: "2024",
    }),
    // Enough small Springfield townships to fill one search page on their own (#241).
    ...Array.from({ length: 55 }, (_, i) =>
      ent(`390${String(i).padStart(2, "0")}74000`.slice(0, 10), "060", "Springfield township", {
        stateFips: "39",
        funcstat: "A",
        aland: 90_000_000,
        population: 900 + i,
        populationVintage: "2024",
      }),
    ),
    // A multi-state metro, named as the production catalog names CBSAs (#293).
    ent("16980", "310", "Chicago-Naperville-Elgin, IL-IN Metro Area", {
      population: 9_260_000,
      populationVintage: "2024",
    }),
    // A state and much smaller same-name places (#291): Colorado County, TX is dominated; New York
    // city (the state is 2.4× it) and Utah County (a fifth of Utah) are not.
    ent("48089", "050", "Colorado County", {
      stateFips: "48",
      lsad: "06",
      aland: 2_487_000_000,
      population: 20_700,
      populationVintage: "2024",
    }),
    ent("3651000", "160", "New York city", {
      stateFips: "36",
      lsad: "25",
      aland: 778_000_000,
      population: 8_300_000,
      populationVintage: "2024",
    }),
    ent("49", "040", "Utah", { stateFips: "49", population: 3_420_000, populationVintage: "2024" }),
    ent("49049", "050", "Utah County", {
      stateFips: "49",
      lsad: "06",
      aland: 5_200_000_000,
      population: 700_000,
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
    { ucgid: uc("48089"), alias: "Colorado", source: "lsad-stripped" },
    { ucgid: uc("3651000"), alias: "New York", source: "lsad-stripped" },
    { ucgid: uc("49049"), alias: "Utah", source: "lsad-stripped" },
    { ucgid: uc("0899999"), alias: "Smallburg", source: "lsad-stripped" },
    { ucgid: uc("0888888"), alias: "Bazville", source: "lsad-stripped" },
    { ucgid: uc("09001"), alias: "Fairfield", source: "lsad-stripped" },
    { ucgid: uc("2970000"), alias: "Springfield", source: "lsad-stripped" },
    { ucgid: uc("1772000"), alias: "Springfield", source: "lsad-stripped" },
    { ucgid: uc("1920035"), alias: "Denver", source: "lsad-stripped" },
    { ucgid: uc("2507000"), alias: "Boston", source: "lsad-stripped" },
    { ucgid: uc("2502507000"), alias: "Boston", source: "lsad-stripped" },
    { ucgid: uc("4201916920"), alias: "Cranberry", source: "lsad-stripped" },
    { ucgid: uc("3602907454"), alias: "Boston", source: "lsad-stripped" },
    { ucgid: uc("2907770009"), alias: "Springfield", source: "lsad-stripped" },
    { ucgid: uc("4212116944"), alias: "Cranberry", source: "lsad-stripped" },
    ...entities
      .filter(
        (e) => e.sumlevel === "060" && e.name === "Springfield township" && e.stateFips === "39",
      )
      .map((e) => ({ ucgid: e.ucgid, alias: "Springfield", source: "lsad-stripped" })),
    { ucgid: uc("0960120"), alias: "Plainfield", source: "lsad-stripped" },
    { ucgid: uc("0915059980"), alias: "Plainfield", source: "lsad-stripped" },
  ];

  const containment: ContainmentRow[] = [
    { childUcgid: uc("08"), parentUcgid: uc("8"), share: 1 },
    { childUcgid: uc("8"), parentUcgid: uc("4"), share: 1 },
    { childUcgid: uc("08031"), parentUcgid: uc("08"), share: 1 },
    { childUcgid: uc("0820000"), parentUcgid: uc("08"), share: 1 },
    { childUcgid: uc("25025"), parentUcgid: uc("25"), share: 1 },
    { childUcgid: uc("2507000"), parentUcgid: uc("25"), share: 1 },
    { childUcgid: uc("2502507000"), parentUcgid: uc("25025"), share: 1 },
    { childUcgid: uc("2502507000"), parentUcgid: uc("25"), share: 1 },
    { childUcgid: uc("2507000"), parentUcgid: uc("2502507000"), share: 1 }, // the twin edge
    { childUcgid: uc("4201916920"), parentUcgid: uc("42019"), share: 1 },
    { childUcgid: uc("4201916920"), parentUcgid: uc("42"), share: 1 },
    { childUcgid: uc("4212116944"), parentUcgid: uc("42121"), share: 1 },
    { childUcgid: uc("4212116944"), parentUcgid: uc("42"), share: 1 },
    { childUcgid: uc("0915059980"), parentUcgid: uc("09"), share: 1 },
    { childUcgid: uc("0960120"), parentUcgid: uc("09"), share: 1 },
    { childUcgid: uc("08031000101"), parentUcgid: uc("80202"), share: 0.6, relation: "overlaps" },
    { childUcgid: uc("08031000102"), parentUcgid: uc("80202"), share: 0.4, relation: "overlaps" },
  ];

  const agencyCodes: AgencyCodeRow[] = [
    { ...code(uc("08031"), "NOTED", "X1"), note: "a caveat that must travel (#153)" },
    code(uc("08031"), "LAUS", "CN0803100000000"),
    code(uc("0820000"), "LAUS", "CT0820000000000"), // the city is above threshold
    code(uc("19740"), "LAUS", "MT0819740000000"),
    // Smallburg (0899999) and Bazville (0888888) have NO LAUS code → below_threshold.
    code(uc("0915059980"), "LAUS", "CS0959980000000"), // Plainfield town has its own LAUS series
    // Cranberry township (4201916920) has none → below_threshold, county fallback (#241).
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

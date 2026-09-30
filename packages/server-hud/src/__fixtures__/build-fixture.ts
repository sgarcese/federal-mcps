import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CatalogRows,
  type ContainmentRow,
  type EntityRow,
  nationRows,
  buildCatalog,
} from "@federal-mcps/geography-build";
import BetterSqlite3 from "better-sqlite3";
import { ucgidOf } from "@federal-mcps/core";

/**
 * A tiny geography catalog for the server-hud suite (M11, shell only: this server mounts
 * only `hud_resolve_place` and `hud_describe_source`, so the fixture needs just enough
 * geography for the resolver's worked example — Denver, at county, place and metro).
 */
export function buildFixtureCatalog(): string {
  const entities: EntityRow[] = [
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
    // M11 (HUD User): the places the recorded fixtures cover (scripts/record-hud-fixtures.mts).
    ent("18", "040", "Indiana", {
      stateFips: "18",
      population: 6_862_199,
      populationVintage: "2024",
    }),
    ent("18141", "050", "St. Joseph County", {
      stateFips: "18",
      lsad: "06",
      aland: 1_186_000_000,
      population: 272_912,
      populationVintage: "2024",
    }),
    ent("1871000", "160", "South Bend city", {
      stateFips: "18",
      lsad: "25",
      aland: 107_000_000,
      population: 103_084,
      populationVintage: "2024",
    }),
    ent("43780", "310", "South Bend-Mishawaka, IN-MI", {
      lsad: "M1",
      population: 324_501,
      populationVintage: "2024",
    }),
    ent("17", "040", "Illinois", {
      stateFips: "17",
      population: 12_710_158,
      populationVintage: "2024",
    }),
    ent("17031", "050", "Cook County", {
      stateFips: "17",
      lsad: "06",
      aland: 2_448_000_000,
      population: 5_182_617,
      populationVintage: "2024",
    }),
    // New England towns (#241): cities with their same-municipality towns, a county HUD does not
    // publish there, and a Connecticut town whose GEOID changed with the 2022 planning regions.
    ent("25", "040", "Massachusetts", {
      stateFips: "25",
      population: 7_000_000,
      populationVintage: "2024",
    }),
    ent("25025", "050", "Suffolk County", {
      stateFips: "25",
      lsad: "06",
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
    ent("50", "040", "Vermont", {
      stateFips: "50",
      population: 648_000,
      populationVintage: "2024",
    }),
    ent("50007", "050", "Chittenden County", {
      stateFips: "50",
      lsad: "06",
      population: 169_000,
      populationVintage: "2024",
    }),
    ent("5010675", "160", "Burlington city", {
      stateFips: "50",
      lsad: "25",
      aland: 27_000_000,
      population: 44_600,
      populationVintage: "2024",
    }),
    ent("5000710675", "060", "Burlington city", {
      stateFips: "50",
      funcstat: "A",
      aland: 27_000_000,
      population: 44_600,
      populationVintage: "2024",
    }),
    ent("09", "040", "Connecticut", {
      stateFips: "09",
      population: 3_600_000,
      populationVintage: "2024",
    }),
    ent("09110", "050", "Capitol Planning Region", {
      stateFips: "09",
      lsad: "PR",
      population: 980_000,
      populationVintage: "2024",
    }),
    ent("0911037070", "060", "Hartford town", {
      stateFips: "09",
      funcstat: "C",
      aland: 45_000_000,
      population: 121_000,
      populationVintage: "2024",
    }),
    // Outside New England a township answers with its county's FMR area (#241).
    ent("42", "040", "Pennsylvania", {
      stateFips: "42",
      population: 13_000_000,
      populationVintage: "2024",
    }),
    ent("42019", "050", "Butler County", {
      stateFips: "42",
      lsad: "06",
      population: 198_000,
      populationVintage: "2024",
    }),
    ent("4201916920", "060", "Cranberry township", {
      stateFips: "42",
      funcstat: "A",
      aland: 59_000_000,
      population: 34_000,
      populationVintage: "2024",
    }),
  ];
  // The United States (#290), built by the production helper so the fixture mirrors the catalog.
  const nation = nationRows(entities);
  for (const e of nation.entities) {
    entities.push({ ...e, population: 334_922_499, populationVintage: "2024" });
  }

  const uc = (geoid: string): string => {
    const e = entities.find((x) => x.geoid === geoid);
    if (!e) throw new Error(`fixture: no entity for geoid ${geoid}`);
    return e.ucgid;
  };

  const aliases = [
    { ucgid: uc("08031"), alias: "Denver", source: "lsad-stripped" },
    { ucgid: uc("0820000"), alias: "Denver", source: "lsad-stripped" },
    { ucgid: uc("19740"), alias: "Denver", source: "hand" },
    { ucgid: uc("18141"), alias: "St. Joseph", source: "lsad-stripped" },
    { ucgid: uc("1871000"), alias: "South Bend", source: "lsad-stripped" },
    { ucgid: uc("43780"), alias: "South Bend", source: "hand" },
    { ucgid: uc("17031"), alias: "Cook", source: "lsad-stripped" },
    { ucgid: uc("25025"), alias: "Suffolk", source: "lsad-stripped" },
    { ucgid: uc("2507000"), alias: "Boston", source: "lsad-stripped" },
    { ucgid: uc("2502507000"), alias: "Boston", source: "lsad-stripped" },
    { ucgid: uc("5010675"), alias: "Burlington", source: "lsad-stripped" },
    { ucgid: uc("5000710675"), alias: "Burlington", source: "lsad-stripped" },
    { ucgid: uc("0911037070"), alias: "Hartford", source: "lsad-stripped" },
    { ucgid: uc("4201916920"), alias: "Cranberry", source: "lsad-stripped" },
    ...nation.aliases,
  ];

  const containment: ContainmentRow[] = [
    { childUcgid: uc("08031"), parentUcgid: uc("08"), share: 1 },
    { childUcgid: uc("0820000"), parentUcgid: uc("08"), share: 1 },
    { childUcgid: uc("18141"), parentUcgid: uc("18"), share: 1 },
    { childUcgid: uc("1871000"), parentUcgid: uc("18141"), share: 1 },
    { childUcgid: uc("1871000"), parentUcgid: uc("18"), share: 1 },
    { childUcgid: uc("18141"), parentUcgid: uc("43780"), share: 1 },
    { childUcgid: uc("17031"), parentUcgid: uc("17"), share: 1 },
    { childUcgid: uc("25025"), parentUcgid: uc("25"), share: 1 },
    { childUcgid: uc("2502507000"), parentUcgid: uc("25025"), share: 1 },
    { childUcgid: uc("2507000"), parentUcgid: uc("25025"), share: 1 },
    { childUcgid: uc("2507000"), parentUcgid: uc("2502507000"), share: 1 }, // town twin
    { childUcgid: uc("5000710675"), parentUcgid: uc("50007"), share: 1 },
    { childUcgid: uc("5010675"), parentUcgid: uc("50007"), share: 1 },
    { childUcgid: uc("5010675"), parentUcgid: uc("5000710675"), share: 1 }, // town twin
    { childUcgid: uc("0911037070"), parentUcgid: uc("09110"), share: 1 },
    { childUcgid: uc("4201916920"), parentUcgid: uc("42019"), share: 1 },
    ...nation.containment,
  ];

  const rows: CatalogRows = {
    entities,
    aliases,
    containment,
    agencyCodes: [
      {
        ucgid: uc("0911037070"),
        agency: "census",
        program: "GEOID2020",
        code: "0900337070",
        codeVintage: 2020,
        note: "the 2020 GEOID, changed since by a Census recode (e.g. Connecticut's 2022 planning regions)",
      },
    ],
    publishesAt: [],
    countyChange: [],
    lineage: [],
  };

  const dir = mkdtempSync(join(tmpdir(), "geo-fixture-hud-"));
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

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ucgidOf } from "@federal-mcps/core";
import {
  type AgencyCodeRow,
  buildCatalog,
  type CatalogRows,
  type ContainmentRow,
  type EntityRow,
} from "@federal-mcps/geography-build";
import BetterSqlite3 from "better-sqlite3";

/**
 * A small geography catalog for the server-bea suite (M14): the places the recorded fixtures cover
 * (scripts/record-*-fixtures.mts) and the geography cases ADR-019 §6 names — a county and its city
 * and metro (St. Joseph, IN), a second county for comparisons (Cook, IL), Denver at three levels, a
 * suppressed county (Loving, TX), a micropolitan county (Marshall, IN), a Virginia combination (Albemarle + Charlottesville, `51901`,
 * carried as `bea`/`GEOFIPS` codes as #257 builds them), and a Connecticut planning region.
 */
export function buildFixtureCatalog(): string {
  const pop = (population: number) => ({ population, populationVintage: "2024" });
  const entities: EntityRow[] = [
    ent("08", "040", "Colorado", { stateFips: "08", ...pop(5_957_493) }),
    ent("08031", "050", "Denver County", {
      stateFips: "08",
      lsad: "06",
      aland: 396_915_495,
      ...pop(715_522),
    }),
    ent("0820000", "160", "Denver city", {
      stateFips: "08",
      lsad: "25",
      aland: 396_000_000,
      ...pop(729_019),
    }),
    ent("19740", "310", "Denver-Aurora-Centennial, CO", { lsad: "M1", ...pop(3_005_131) }),
    ent("18", "040", "Indiana", { stateFips: "18", ...pop(6_862_199) }),
    ent("18141", "050", "St. Joseph County", {
      stateFips: "18",
      lsad: "06",
      aland: 1_186_000_000,
      ...pop(272_912),
    }),
    ent("1871000", "160", "South Bend city", {
      stateFips: "18",
      lsad: "25",
      aland: 107_000_000,
      ...pop(103_084),
    }),
    ent("43780", "310", "South Bend-Mishawaka, IN-MI", { lsad: "M1", ...pop(324_501) }),
    ent("17", "040", "Illinois", { stateFips: "17", ...pop(12_710_158) }),
    ent("17031", "050", "Cook County", {
      stateFips: "17",
      lsad: "06",
      aland: 2_448_000_000,
      ...pop(5_182_617),
    }),
    ent("16980", "310", "Chicago-Naperville-Elgin, IL-IN", { lsad: "M1", ...pop(9_260_000) }),
    // A micropolitan county (Marshall County, IN in the Plymouth micro area): BEA's metro tables
    // do not cover micro areas, so regional price parities answer with the state's nonmetro portion.
    ent("18099", "050", "Marshall County", { stateFips: "18", lsad: "06", ...pop(46_000) }),
    ent("38500", "310", "Plymouth, IN", { lsad: "M2", ...pop(46_000) }),
    ent("48", "040", "Texas", { stateFips: "48", ...pop(30_500_000) }),
    ent("48301", "050", "Loving County", {
      stateFips: "48",
      lsad: "06",
      aland: 1_732_000_000,
      ...pop(64),
    }),
    ent("51", "040", "Virginia", { stateFips: "51", ...pop(8_700_000) }),
    ent("51003", "050", "Albemarle County", {
      stateFips: "51",
      lsad: "06",
      aland: 1_866_000_000,
      ...pop(115_000),
    }),
    ent("51540", "050", "Charlottesville city", {
      stateFips: "51",
      lsad: "25",
      aland: 26_500_000,
      ...pop(46_500),
    }),
    ent("5114968", "160", "Charlottesville city", {
      stateFips: "51",
      lsad: "25",
      aland: 26_500_000,
      ...pop(46_500),
    }),
    ent("09", "040", "Connecticut", { stateFips: "09", ...pop(3_600_000) }),
    ent("09110", "050", "Capitol Planning Region", {
      stateFips: "09",
      lsad: "PR",
      ...pop(980_000),
    }),
  ];

  const uc = (geoid: string, sumlevel?: string): string => {
    const e = entities.find((x) => x.geoid === geoid && (!sumlevel || x.sumlevel === sumlevel));
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
    { ucgid: uc("18099"), alias: "Marshall", source: "lsad-stripped" },
    { ucgid: uc("48301"), alias: "Loving", source: "lsad-stripped" },
    { ucgid: uc("51003"), alias: "Albemarle", source: "lsad-stripped" },
    { ucgid: uc("51540", "050"), alias: "Charlottesville", source: "lsad-stripped" },
    { ucgid: uc("5114968"), alias: "Charlottesville", source: "lsad-stripped" },
    { ucgid: uc("09110"), alias: "Capitol", source: "lsad-stripped" },
  ];

  const nests = (child: string, parent: string, share = 1): ContainmentRow => ({
    childUcgid: child,
    parentUcgid: parent,
    share,
  });
  const containment: ContainmentRow[] = [
    nests(uc("08031"), uc("08")),
    nests(uc("0820000"), uc("08")),
    nests(uc("0820000"), uc("08031")),
    nests(uc("08031"), uc("19740")),
    nests(uc("18141"), uc("18")),
    nests(uc("1871000"), uc("18")),
    nests(uc("1871000"), uc("18141")),
    nests(uc("18141"), uc("43780")),
    nests(uc("17031"), uc("17")),
    nests(uc("17031"), uc("16980")),
    nests(uc("18099"), uc("18")),
    nests(uc("18099"), uc("38500")),
    nests(uc("48301"), uc("48")),
    nests(uc("51003"), uc("51")),
    nests(uc("51540", "050"), uc("51")),
    nests(uc("5114968"), uc("51540", "050")),
    nests(uc("09110"), uc("09")),
  ];

  const combination = (geoid: string, name: string): AgencyCodeRow => ({
    ucgid: uc(geoid, "050"),
    agency: "bea",
    program: "GEOFIPS",
    code: "51901",
    codeVintage: null,
    note: `BEA publishes ${name} only combined, as "Albemarle + Charlottesville, VA" (51901).`,
  });

  const rows: CatalogRows = {
    entities,
    aliases,
    containment,
    agencyCodes: [
      combination("51003", "Albemarle County"),
      combination("51540", "Charlottesville city"),
    ],
    publishesAt: [],
    countyChange: [],
    lineage: [],
  };

  const dir = mkdtempSync(join(tmpdir(), "geo-fixture-bea-"));
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

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CatalogRows,
  type ContainmentRow,
  type EntityRow,
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
  ];

  const uc = (geoid: string): string => {
    const e = entities.find((x) => x.geoid === geoid);
    if (!e) throw new Error(`fixture: no entity for geoid ${geoid}`);
    return e.ucgid;
  };

  const aliases = [
    { ucgid: uc("08031"), alias: "Denver", source: "lsad-stripped" },
    { ucgid: uc("0820000"), alias: "Denver", source: "lsad-stripped" },
    { ucgid: uc("19740"), alias: "Denver", source: "hand" },
  ];

  const containment: ContainmentRow[] = [
    { childUcgid: uc("08031"), parentUcgid: uc("08"), share: 1 },
    { childUcgid: uc("0820000"), parentUcgid: uc("08"), share: 1 },
  ];

  const rows: CatalogRows = {
    entities,
    aliases,
    containment,
    agencyCodes: [],
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

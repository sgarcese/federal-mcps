import { ucgidOf } from "@federal-mcps/core";
import type { AliasRow, EntityRow } from "../types.js";

/**
 * Census National Gazetteer files: tab-delimited, one header row, one entity per line.
 * Column sets differ by entity type, so we map by header NAME rather than position.
 * The caller supplies the `sumlevel` (the gazetteer file is per entity type).
 *
 * Common columns: USPS, GEOID, ANSICODE, NAME, LSAD, FUNCSTAT, ALAND, AWATER,
 * ALAND_SQMI, AWATER_SQMI, INTPTLAT, INTPTLONG. Not all appear in every file.
 */
export function parseGazetteer(
  text: string,
  sumlevel: string,
): { entities: EntityRow[]; aliases: AliasRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.shift();
  if (!header) return { entities: [], aliases: [] };
  const cols = header.split("\t").map((c) => c.trim().toUpperCase());
  const idx = (name: string): number => cols.indexOf(name);

  const iGeoid = idx("GEOID");
  const iName = idx("NAME");
  if (iGeoid < 0 || iName < 0) {
    throw new Error(`gazetteer: header lacks GEOID or NAME (got ${cols.join(",")})`);
  }
  const iAnsi = idx("ANSICODE");
  const iLsad = idx("LSAD");
  const iFunc = idx("FUNCSTAT");
  const iAland = idx("ALAND");
  const iLat = idx("INTPTLAT");
  const iLon = idx("INTPTLONG");

  const entities: EntityRow[] = [];
  const aliases: AliasRow[] = [];

  for (const line of lines) {
    const f = line.split("\t");
    const geoid = f[iGeoid]?.trim();
    const name = f[iName]?.trim();
    if (!geoid || !name) continue;

    const num = (i: number): number | null => {
      if (i < 0) return null;
      const v = f[i]?.trim();
      if (!v) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const str = (i: number): string | null => (i < 0 ? null : (f[i]?.trim() ?? null) || null);

    entities.push({
      ucgid: ucgidOf(sumlevel, geoid),
      geoid,
      sumlevel,
      name,
      lsad: str(iLsad),
      funcstat: str(iFunc),
      stateFips: stateFipsFromGeoid(geoid, sumlevel),
      gnis: str(iAnsi),
      lat: num(iLat),
      lon: num(iLon),
      aland: num(iAland),
    });

    // A normalized alias with the LSAD noise stripped ("Denver city" → "Denver"),
    // so fuzzy resolution matches the bare name a user types.
    const bare = stripLsad(name);
    if (bare && bare !== name) {
      aliases.push({ ucgid: ucgidOf(sumlevel, geoid), alias: bare, source: "lsad-stripped" });
    }
  }

  return { entities, aliases };
}

/** State FIPS is the leading 2 digits for state-nested entities; null for CBSA/ZCTA/CSA. */
function stateFipsFromGeoid(geoid: string, sumlevel: string): string | null {
  const stateNested = new Set([
    "040",
    "050",
    "060",
    "140",
    "150",
    "160",
    "500",
    "950",
    "960",
    "970",
  ]);
  if (sumlevel === "040") return geoid.slice(0, 2);
  if (stateNested.has(sumlevel) && geoid.length >= 2) return geoid.slice(0, 2);
  return null;
}

const LSAD_WORDS = [
  "city and borough",
  "census area",
  "metropolitan statistical area",
  "micropolitan statistical area",
  "county",
  "parish",
  "borough",
  "municipality",
  "city",
  "town",
  "village",
  "township",
  "CDP",
];

/** Removes a trailing LSAD word ("Denver city" → "Denver", "Denver County" → "Denver"). */
export function stripLsad(name: string): string {
  const lower = name.toLowerCase();
  for (const w of LSAD_WORDS) {
    if (lower.endsWith(` ${w}`)) {
      return name.slice(0, name.length - w.length - 1).trim();
    }
  }
  return name;
}

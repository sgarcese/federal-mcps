/**
 * Census geographic identifiers. A GEOID is unique only within a summary level — county,
 * CBSA and ZCTA GEOIDs are all 5 digits and collide — so the catalog keys entities by
 * their UCGID (ADR-003 §6 as amended, #73), the Census Uniform Geographic Identifier,
 * which is unique across levels. This is the one place the format is defined.
 */

/** The nation's summary level (#290). */
const NATION = "010";

/**
 * `<sumlevel>0000US<geoid>` — e.g. county 06075 → `0500000US06075`, ZCTA 06075 → `8600000US06075`.
 * The nation has no GEOID suffix: Census writes it `0100000US` (#290), whether the caller spells
 * its GEOID `US` (the catalog, after TIGER's nation file) or `1` (the Census API's `us` column).
 */
export function ucgidOf(sumlevel: string, geoid: string): string {
  if (sumlevel === NATION) return "0100000US";
  return `${sumlevel}0000US${geoid}`;
}

/**
 * Data Commons DCID: the nation is `country/USA`; CBSAs/metro divisions use `geoId/C…`, ZCTAs
 * `zip/…`, everything else `geoId/…`.
 */
export function dcidOf(sumlevel: string, geoid: string): string {
  if (sumlevel === NATION) return "country/USA";
  if (sumlevel === "310" || sumlevel === "314") return `geoId/C${geoid}`;
  if (sumlevel === "860") return `zip/${geoid}`;
  return `geoId/${geoid}`;
}

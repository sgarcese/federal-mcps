/**
 * Census geographic identifiers. A GEOID is unique only within a summary level — county,
 * CBSA and ZCTA GEOIDs are all 5 digits and collide — so the catalog keys entities by
 * their UCGID (ADR-003 §6 as amended, #73), the Census Uniform Geographic Identifier,
 * which is unique across levels. This is the one place the format is defined.
 */

/** `<sumlevel>0000US<geoid>` — e.g. county 06075 → `0500000US06075`, ZCTA 06075 → `8600000US06075`. */
export function ucgidOf(sumlevel: string, geoid: string): string {
  return `${sumlevel}0000US${geoid}`;
}

/** Data Commons DCID for a place: counties/states/... are `geoId/<geoid>`; CBSAs are `geoId/C<geoid>`. */
export function dcidOf(sumlevel: string, geoid: string): string {
  return sumlevel === "310" ? `geoId/C${geoid}` : `geoId/${geoid}`;
}

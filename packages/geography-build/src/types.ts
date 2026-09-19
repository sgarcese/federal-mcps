/**
 * Row shapes for the geography catalog tables (geography-catalog spike; ADR-003, ADR-008).
 * These are the typed rows the parsers produce and `buildCatalog` inserts.
 */

/** One geographic entity: a state, county, place, tract, CBSA, ZCTA, … */
export interface EntityRow {
  /** Census UCGID — the primary key, unique across summary levels (#73). e.g. "0500000US08031". */
  ucgid: string;
  /** Census GEOID (not unique across levels). County "08031", place "0820000", CBSA "19740". */
  geoid: string;
  /** Census summary level: "040" state, "050" county, "160" place, "310" CBSA, "860" ZCTA, … */
  sumlevel: string;
  name: string;
  /** Legal/Statistical Area Description code (place/county type), when known. */
  lsad: string | null;
  /** Functional status (A active, S statistical, …), when known. */
  funcstat: string | null;
  /** 2-digit state FIPS, when the entity has one (null for national/region). */
  stateFips: string | null;
  /** GNIS/ANSI code, when known. */
  gnis: string | null;
  lat: number | null;
  lon: number | null;
  /** Land area, square meters, when known. */
  aland: number | null;
  /** ACS 5-year total population (`B01003_001E`), when known (#172, ADR-014 §6). */
  population?: number | null;
  /** The ACS 5-year vintage the population reflects, e.g. "2024" (2020–2024) (#172). */
  populationVintage?: string | null;
}

/** An alternate or normalized name for an entity (feeds fuzzy resolution). */
export interface AliasRow {
  ucgid: string;
  alias: string;
  /** Where the alias came from: "gazetteer", "lsad-stripped", "hand", … */
  source: string;
}

/** A containment edge. `share` = 1.0 when nested; area/pop-weighted otherwise (added in #55). */
export interface ContainmentRow {
  childUcgid: string;
  parentUcgid: string;
  share: number;
  /**
   * How the two relate: "nests" = a containment-hierarchy edge (share = fraction of the
   * child inside the parent; 1.0 for strict nesting, an allocation for a place spanning
   * counties); "overlaps" = an areal overlap between non-nesting layers (share = fraction
   * of the anchor/parent covered by the child), e.g. a ZCTA's tracts. Defaults to "nests".
   */
  relation?: "nests" | "overlaps";
}

/** An agency-specific code for an entity: BLS LAUS/CES/OEWS/CPI area codes, etc. */
export interface AgencyCodeRow {
  ucgid: string;
  /** "bls", later "census", "cdc". */
  agency: string;
  /** Program: "LAUS", "SM" (CES State & Area), "OEWS", "CPI". */
  program: string;
  /** The agency's own code for this entity (e.g. LAUS area code "MT0819740000000"). */
  code: string;
  /** Delineation vintage the code reflects (e.g. 2023), when relevant. */
  codeVintage: number | null;
  note: string | null;
}

/** Which sumlevel a program publishes at, and any constraint (e.g. LAUS cities ≥25k). */
export interface PublishesAtRow {
  agency: string;
  program: string;
  sumlevel: string;
  /** Human/model-readable constraint, e.g. "incorporated place, pop >= 25000". */
  constraintNote: string | null;
}

/** A county-equivalent boundary change (CT planning regions, AK, SD, VA). */
export interface CountyChangeRow {
  oldUcgid: string;
  newUcgid: string;
  /** ISO date the change took effect. */
  effective: string;
  /** "split", "merge", "rename", "recode". */
  kind: string;
}

/** Tract lineage across vintages (2010 → 2020). Populated by #55. */
export interface LineageRow {
  fromUcgid: string;
  toUcgid: string;
  fromVintage: number;
  toVintage: number;
  share: number;
}

/** Everything a catalog build inserts. Overlap/lineage arrive with #55. */
export interface CatalogRows {
  entities: EntityRow[];
  aliases: AliasRow[];
  containment: ContainmentRow[];
  agencyCodes: AgencyCodeRow[];
  publishesAt: PublishesAtRow[];
  countyChange: CountyChangeRow[];
  lineage: LineageRow[];
}

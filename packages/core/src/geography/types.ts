/**
 * The geography resolver's public shapes (ADR-003 as amended, ADR-008). These are the
 * seam the model-facing tools (#57) and `server-geo` (#58) consume, so keep them stable.
 */

/** A summary level with a model-readable label. */
export interface PlaceKind {
  /** Census summary level: "040" state, "050" county, "160" place, "310" CBSA, "860" ZCTA. */
  sumlevel: string;
  label: string;
}

/** A machine-checkable caveat the caller can branch on (ADR-008 §3). Never prose-only. */
export type GeographyFlag =
  | "below_threshold" // e.g. a place under the LAUS 25,000 cutoff — data falls back to county
  | "non_nesting" // a CBSA/CSA/ZCTA that overlaps but does not nest in the hierarchy
  | "vintage_mismatch" // this geoid changed across vintages (county_change) — joins may break
  | "suppressed" // a value is suppressed (set by data tools, not resolution)
  | "cdp" // a census designated place: unincorporated, no local government, no LAUS series
  | "consolidated_city" // a consolidated city or its "balance" — not the county
  | "ambiguous"; // returned as one of several kinds the query could mean

/** A shallow parent (its own `parents` are omitted). */
export interface PlaceParent {
  geoid: string;
  name: string;
  kind: PlaceKind;
}

/** An agency's own code for a place (BLS LAUS/CES/OEWS/CPI area codes). */
export interface AgencyCode {
  agency: string;
  program: string;
  code: string;
  /** A caveat recorded on the code at build (e.g. a multi-state metro filed under one state, #153). */
  note?: string;
}

/** What a program publishes at this place's level, and whether this place has a code for it. */
export interface Availability {
  agency: string;
  program: string;
  sumlevel: string;
  /** True when an agency code exists for this exact place; false means fall back (e.g. to county). */
  hasCode: boolean;
  constraintNote: string | null;
}

/** One resolved place with every identifier, its parents, availability, and flags. */
export interface PlaceCandidate {
  geoid: string;
  ucgid: string;
  dcid: string;
  name: string;
  kind: PlaceKind;
  stateFips: string | null;
  parents: PlaceParent[];
  agencyCodes: AgencyCode[];
  availableAt: Availability[];
  flags: GeographyFlag[];
  caveat?: string;
  /** Ranking score; higher is a better match. */
  score: number;
}

export interface ResolveOptions {
  /** Restrict to a kind: a sumlevel ("050") or a label ("county", "metro", "city"). */
  kind?: string;
  /** Restrict to a state: 2-digit FIPS or a 2-letter USPS abbreviation. */
  state?: string;
  /** Max candidates to return (default 10). */
  limit?: number;
}

/**
 * The resolver stops rather than guesses when a query means several kinds of place with no
 * `kind` hint (ADR-003 §7): city vs county vs metro. `explanation` names the difference.
 */
export type ResolveResult =
  | { status: "ok"; candidates: PlaceCandidate[] }
  | { status: "ambiguous"; candidates: PlaceCandidate[]; explanation: string };

/** A weighted containment or overlap edge (a place's parents, or a ZCTA's tracts). */
export interface GeographyEdge {
  geoid: string;
  name: string;
  kind: PlaceKind;
  /** Allocation share in [0,1]; 1.0 for strict nesting. */
  share: number;
  /** "nests" = containment hierarchy; "overlaps" = areal overlap (ADR-008 §2, #57). */
  relation: "nests" | "overlaps";
}

/** A tract's succession across vintages (2010 → 2020). */
export interface LineageEdge {
  fromGeoid: string;
  toGeoid: string;
  fromVintage: number;
  toVintage: number;
  share: number;
}

/** Human/model-readable labels for the summary levels the catalog carries. */
export const SUMLEVEL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "040": "state",
  "050": "county",
  "060": "county subdivision",
  "140": "census tract",
  "160": "place",
  "170": "consolidated city",
  "310": "metropolitan statistical area",
  "314": "metropolitan division",
  "330": "combined statistical area",
  "500": "congressional district",
  "860": "ZCTA",
});

export function labelForSumlevel(sumlevel: string): string {
  return SUMLEVEL_LABELS[sumlevel] ?? `summary level ${sumlevel}`;
}

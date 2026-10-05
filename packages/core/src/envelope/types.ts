/**
 * Provenance envelope types (#4).
 *
 * These are the plain TypeScript shapes; `schema.ts` mirrors them as Zod
 * schemas for runtime validation and round-tripping over the wire.
 */
import { dcidOf, ucgidOf } from "../geography/identifiers.js";

/** The place a value is reported for, plus every cross-agency identifier (ADR-003 §6). */
export interface PlaceRef {
  /** Census GEOID, e.g. "08031" for Denver County. */
  geoid: string;
  /** Census "Uniform Geographic Identifier" used by data.census.gov, e.g. "0500000US08031". */
  ucgid: string;
  /** Data Commons DCID. For most sumlevels this equals `geoId/${geoid}`. */
  dcid: string;
  name: string;
  kind: {
    /** Census summary level code, e.g. "050" for county. */
    sumlevel: string;
    label: string;
  };
  /** Containing places, shallow: each parent's own `parents` is empty. */
  parents: PlaceRef[];
  /** A caller-facing note, e.g. "below the LAUS 25,000 threshold". */
  caveat?: string;
}

/** Where a value came from: agency, program, the specific series/variable IDs, and how to cite it. */
export interface Source {
  /** Agency code, e.g. "bls", "census", "cdc". Used to look up a display name for citations. */
  agency: string;
  program: string;
  dataset?: string;
  /** The series, variable or table IDs that produced `data`. */
  ids: string[];
  url: string;
  /** A ready-to-paste citation string. Built with `buildCitation`. */
  citation: string;
}

export const FOOTNOTE_FLAGS = ["preliminary", "revised", "suppressed", "unavailable"] as const;

export type FootnoteFlag = (typeof FOOTNOTE_FLAGS)[number];

/** A caveat attached to one or more data points, e.g. a BLS preliminary/revised flag. */
export interface Footnote {
  code: string;
  text: string;
  flags: FootnoteFlag[];
}

const AGENCY_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  bls: "U.S. Bureau of Labor Statistics",
  census: "U.S. Census Bureau",
  cdc: "Centers for Disease Control and Prevention",
  hud: "U.S. Department of Housing and Urban Development",
  bea: "U.S. Bureau of Economic Analysis",
});

/** Looks up an agency's display name for citations, falling back to the code itself. */
export function agencyDisplayName(agency: string): string {
  return AGENCY_DISPLAY_NAMES[agency] ?? agency;
}

/**
 * Builds a ready-to-paste citation string, e.g.:
 * "U.S. Bureau of Labor Statistics, Local Area Unemployment Statistics, series
 * LAUCN080310000000003. Retrieved 2026-09-08 from https://api.bls.gov/..."
 */
export function buildCitation(
  source: Pick<Source, "agency" | "program" | "ids" | "url">,
  retrievedAt: Date | string,
): string {
  const retrievedDate = typeof retrievedAt === "string" ? retrievedAt : retrievedAt.toISOString();
  const dateOnly = retrievedDate.slice(0, 10);
  return (
    `${agencyDisplayName(source.agency)}, ${source.program}, series ${source.ids.join(", ")}. ` +
    `Retrieved ${dateOnly} from ${source.url}`
  );
}

/** BLS-style footnote codes mapped to structured flags. Small and tested, not exhaustive. */
const FOOTNOTE_CODE_FLAGS: Readonly<Record<string, readonly FootnoteFlag[]>> = Object.freeze({
  P: ["preliminary"],
  R: ["revised"],
  "-": ["unavailable"],
  "(D)": ["suppressed"],
});

/** Maps a BLS-style footnote code to structured flags; unknown codes map to no flags. */
export function footnoteFlagsFromCode(code: string): FootnoteFlag[] {
  return [...(FOOTNOTE_CODE_FLAGS[code] ?? [])];
}

export interface PlaceRefInput {
  geoid: string;
  /** Census summary level code, e.g. "050" county, "310" CBSA, "860" ZCTA. */
  sumlevel: string;
  label: string;
  name: string;
  parents?: PlaceRef[];
  caveat?: string;
  /** Override the derived UCGID (rare; e.g. non-standard geographies). */
  ucgid?: string;
  /** Override the derived DCID (rare; e.g. non-standard geographies). */
  dcid?: string;
}

/**
 * Builds a `PlaceRef`, deriving `ucgid` and `dcid` from `geoid` and `sumlevel`
 * per ADR-003 §6 through the one definition of each (`geography/identifiers.ts`). Denver
 * County (geoid "08031", sumlevel "050") derives ucgid "0500000US08031" and dcid
 * "geoId/08031"; the nation (#290) "0100000US" and "country/USA".
 */
export function placeRef(input: PlaceRefInput): PlaceRef {
  const { geoid, sumlevel, label, name, parents, caveat, ucgid, dcid } = input;
  const result: PlaceRef = {
    geoid,
    ucgid: ucgid ?? ucgidOf(sumlevel, geoid),
    dcid: dcid ?? dcidOf(sumlevel, geoid),
    name,
    kind: { sumlevel, label },
    parents: parents ?? [],
  };
  if (caveat !== undefined) {
    result.caveat = caveat;
  }
  return result;
}

/**
 * The `limit` block (ADR-020 §4, #323): on a refusal only, whose share was spent, of what, how
 * much and when it resets. It mirrors the limiter's `LimitInfo`, except that `limit` and `used`
 * may be absent: an agency that refuses on its own count (BLS's daily threshold) does not say the
 * numbers, and the envelope never invents them.
 */
export interface EnvelopeLimit {
  /** One network, the claude.ai pool, or the whole service. */
  scope: "network" | "pool" | "service";
  /** Upstream queries to an agency, or tool calls to this server. */
  kind: "upstream" | "toolCalls";
  /** The upstream budget key (e.g. "bls", "bls-qcew"), for `kind: "upstream"`. */
  source?: string;
  limit?: number;
  used?: number;
  /** ISO time the share resets. */
  resetsAt: string;
}

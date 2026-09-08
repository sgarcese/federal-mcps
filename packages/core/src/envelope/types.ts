/**
 * Provenance envelope types (#4).
 *
 * These are the plain TypeScript shapes; `schema.ts` mirrors them as Zod
 * schemas for runtime validation and round-tripping over the wire.
 */

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

const CBSA_SUMLEVEL = "310";
const ZCTA_SUMLEVEL = "860";

function deriveDcid(geoid: string, sumlevel: string): string {
  if (sumlevel === CBSA_SUMLEVEL) {
    return `geoId/C${geoid}`;
  }
  if (sumlevel === ZCTA_SUMLEVEL) {
    return `zip/${geoid}`;
  }
  return `geoId/${geoid}`;
}

/**
 * Builds a `PlaceRef`, deriving `ucgid` and `dcid` from `geoid` and `sumlevel`
 * per ADR-003 §6. Denver County (geoid "08031", sumlevel "050") derives
 * ucgid "0500000US08031" and dcid "geoId/08031".
 */
export function placeRef(input: PlaceRefInput): PlaceRef {
  const { geoid, sumlevel, label, name, parents, caveat, ucgid, dcid } = input;
  const result: PlaceRef = {
    geoid,
    ucgid: ucgid ?? `${sumlevel}0000US${geoid}`,
    dcid: dcid ?? deriveDcid(geoid, sumlevel),
    name,
    kind: { sumlevel, label },
    parents: parents ?? [],
  };
  if (caveat !== undefined) {
    result.caveat = caveat;
  }
  return result;
}

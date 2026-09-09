import type { EntityRecord, GeographyCatalog } from "./catalog.js";
import { deriveFlags } from "./flags.js";
import {
  type Availability,
  type GeographyEdge,
  type LineageEdge,
  labelForSumlevel,
  type PlaceCandidate,
  type PlaceParent,
  type ResolveOptions,
  type ResolveResult,
} from "./types.js";

const USPS_TO_FIPS: Readonly<Record<string, string>> = Object.freeze({
  AL: "01",
  AK: "02",
  AZ: "04",
  AR: "05",
  CA: "06",
  CO: "08",
  CT: "09",
  DE: "10",
  DC: "11",
  FL: "12",
  GA: "13",
  HI: "15",
  ID: "16",
  IL: "17",
  IN: "18",
  IA: "19",
  KS: "20",
  KY: "21",
  LA: "22",
  ME: "23",
  MD: "24",
  MA: "25",
  MI: "26",
  MN: "27",
  MS: "28",
  MO: "29",
  MT: "30",
  NE: "31",
  NV: "32",
  NH: "33",
  NJ: "34",
  NM: "35",
  NY: "36",
  NC: "37",
  ND: "38",
  OH: "39",
  OK: "40",
  OR: "41",
  PA: "42",
  RI: "44",
  SC: "45",
  SD: "46",
  TN: "47",
  TX: "48",
  UT: "49",
  VT: "50",
  VA: "51",
  WA: "53",
  WV: "54",
  WI: "55",
  WY: "56",
});

/** Maps a kind hint (a sumlevel or a label like "county"/"metro"/"city") to sumlevels. */
const KIND_HINTS: Readonly<Record<string, string[]>> = Object.freeze({
  state: ["040"],
  county: ["050"],
  city: ["160"],
  place: ["160"],
  town: ["160"],
  metro: ["310"],
  "metro area": ["310"],
  cbsa: ["310"],
  "metropolitan statistical area": ["310"],
  "metro division": ["314"],
  csa: ["330"],
  zcta: ["860"],
  zip: ["860"],
  tract: ["140"],
});

/** Longest query we tokenize; anything past this is a caller error or an attack, not a place name. */
const MAX_QUERY_LENGTH = 200;

/**
 * Resolves a place name to ranked candidates, each carrying every identifier, its parents,
 * what data is available at its level, and structured flags. Stops with `status:
 * "ambiguous"` when a query means several kinds of place and no kind was given (ADR-003 §7).
 */
export function resolvePlace(
  catalog: GeographyCatalog,
  query: string,
  options: ResolveOptions = {},
): ResolveResult {
  // Bound user input before it reaches FTS5: cap length (a megabyte query would make the
  // trigram tokenizer do needless work) and require the trigram minimum of 3 characters.
  const bounded = query.slice(0, MAX_QUERY_LENGTH);
  if (bounded.trim().length < 3) return { status: "ok", candidates: [] };

  const stateFips = normalizeState(options.state);
  const sumlevels = normalizeKind(options.kind);
  const normQuery = normalizeName(bounded);

  const searchOpts: { stateFips?: string; sumlevels?: string[]; limit: number } = { limit: 50 };
  if (stateFips) searchOpts.stateFips = stateFips;
  if (sumlevels) searchOpts.sumlevels = sumlevels;

  const rows = catalog.searchNames(bounded, searchOpts);
  const scored = rows
    .map((e) => scoreCandidate(catalog, e, normQuery))
    .sort((a, b) => b.score - a.score);

  const limit = options.limit ?? 10;
  const candidates = scored.slice(0, limit);

  // Ambiguity: with no kind hint, if the strong (exact-name) matches span more than one
  // kind (city vs county vs metro), stop and let the caller choose.
  if (!options.kind) {
    const strongKinds = new Set(
      scored.filter((c) => c.isExact).map((c) => c.candidate.kind.sumlevel),
    );
    if (strongKinds.size > 1) {
      const flagged = candidates.map((c) => ({
        ...c.candidate,
        flags: c.candidate.flags.includes("ambiguous")
          ? c.candidate.flags
          : [...c.candidate.flags, "ambiguous" as const],
      }));
      const kinds = [...strongKinds].map(labelForSumlevel).join(", ");
      return {
        status: "ambiguous",
        candidates: flagged,
        explanation: `"${query}" matches more than one kind of place (${kinds}). Specify a kind to choose.`,
      };
    }
  }

  return { status: "ok", candidates: candidates.map((c) => c.candidate) };
}

/** A place's containment-hierarchy parents with shares (place → county → CBSA → state). */
export function getContainment(catalog: GeographyCatalog, geoid: string): GeographyEdge[] {
  return catalog.parentsOf(geoid).map(({ entity, share }) => edge(entity, share, "nests"));
}

/** A place's areal overlaps with allocation shares — e.g. a ZCTA's overlapping tracts. */
export function getOverlap(catalog: GeographyCatalog, geoid: string): GeographyEdge[] {
  return catalog.overlapsOf(geoid).map(({ entity, share }) => edge(entity, share, "overlaps"));
}

/** A tract's successors across vintages (2010 → 2020). */
export function getLineage(catalog: GeographyCatalog, geoid: string): LineageEdge[] {
  return catalog.lineageFrom(geoid);
}

// --- internals ---------------------------------------------------------------

interface Scored {
  candidate: PlaceCandidate;
  score: number;
  isExact: boolean;
}

function scoreCandidate(catalog: GeographyCatalog, e: EntityRecord, normQuery: string): Scored {
  const aliases = catalog.aliasesOf(e.geoid);
  const names = [e.name, ...aliases].map(normalizeName);
  const isExact = names.includes(normQuery);
  const isPrefix = names.some((n) => n.startsWith(normQuery));

  let score = 0;
  if (isExact) score += 1000;
  else if (isPrefix) score += 500;
  // Larger places first (land area as a stand-in for population), gently.
  score += Math.log10((e.aland ?? 1) + 10);
  // Prefer real places over CDPs and consolidated-city balances when otherwise equal.
  if (e.lsad === "57" || /\(balance\)/i.test(e.name)) score -= 5;

  const agencyCodes = catalog.agencyCodesOf(e.geoid);
  const { flags, caveat } = deriveFlags(
    { geoid: e.geoid, sumlevel: e.sumlevel, name: e.name, lsad: e.lsad },
    agencyCodes,
    catalog.hasCountyChange(e.geoid),
  );

  const candidate: PlaceCandidate = {
    geoid: e.geoid,
    ucgid: `${e.sumlevel}0000US${e.geoid}`,
    dcid: deriveDcid(e.geoid, e.sumlevel),
    name: e.name,
    kind: { sumlevel: e.sumlevel, label: labelForSumlevel(e.sumlevel) },
    stateFips: e.state_fips,
    parents: catalog.parentsOf(e.geoid).map(({ entity }) => parent(entity)),
    agencyCodes,
    availableAt: availabilityFor(catalog, e.sumlevel, agencyCodes),
    flags,
    score,
  };
  if (caveat !== undefined) candidate.caveat = caveat;

  return { candidate, score, isExact };
}

function availabilityFor(
  catalog: GeographyCatalog,
  sumlevel: string,
  agencyCodes: readonly { agency: string; program: string }[],
): Availability[] {
  return catalog.publishesAt(sumlevel).map((p) => ({
    agency: p.agency,
    program: p.program,
    sumlevel: p.sumlevel,
    hasCode: agencyCodes.some((c) => c.agency === p.agency && c.program === p.program),
    constraintNote: p.constraint_note,
  }));
}

function edge(e: EntityRecord, share: number, relation: "nests" | "overlaps"): GeographyEdge {
  return {
    geoid: e.geoid,
    name: e.name,
    kind: { sumlevel: e.sumlevel, label: labelForSumlevel(e.sumlevel) },
    share,
    relation,
  };
}

function parent(e: EntityRecord): PlaceParent {
  return {
    geoid: e.geoid,
    name: e.name,
    kind: { sumlevel: e.sumlevel, label: labelForSumlevel(e.sumlevel) },
  };
}

/** Data Commons DCID: CBSAs use `geoId/C…`, ZCTAs `zip/…`, everything else `geoId/…`. */
function deriveDcid(geoid: string, sumlevel: string): string {
  if (sumlevel === "310" || sumlevel === "314") return `geoId/C${geoid}`;
  if (sumlevel === "860") return `zip/${geoid}`;
  return `geoId/${geoid}`;
}

const LSAD_SUFFIX =
  /\s+(county|parish|borough|census area|city and borough|municipality|city|town|village|township|metropolitan statistical area|micropolitan statistical area)$/i;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(LSAD_SUFFIX, "").replace(/[.,]/g, "").trim();
}

function normalizeState(state: string | undefined): string | undefined {
  if (!state) return undefined;
  const s = state.trim().toUpperCase();
  if (/^\d{2}$/.test(s)) return s;
  return USPS_TO_FIPS[s];
}

function normalizeKind(kind: string | undefined): string[] | undefined {
  if (!kind) return undefined;
  const k = kind.trim().toLowerCase();
  if (/^\d{3}$/.test(k)) return [k];
  return KIND_HINTS[k];
}

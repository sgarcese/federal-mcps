import type { EntityRecord, GeographyCatalog } from "./catalog.js";
import { dcidOf } from "./identifiers.js";
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

const FIPS_TO_USPS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(USPS_TO_FIPS).map(([usps, fips]) => [fips, usps])),
);

/**
 * The two-letter USPS abbreviation for a 2-digit state FIPS code (e.g. "18" → "IN"), for agency
 * APIs keyed by state code (HUD User's Picture of Subsidized Households, M11). Geography stays in
 * core: servers ask here instead of carrying their own table.
 */
export function uspsOfStateFips(fips: string): string | undefined {
  return FIPS_TO_USPS[fips];
}

/**
 * Same-name places in other states are rivals unless the leader has at least this many times
 * the runner-up's population (#187): Springfield MO/IL and Portland OR/ME stop; Denver CO
 * against a 1,800-person Denver, IA does not.
 */
const STATE_DOMINANCE_RATIO = 10;

/** Maps a kind hint (a sumlevel or a label like "county"/"metro"/"city") to sumlevels. */
const KIND_HINTS: Readonly<Record<string, string[]>> = Object.freeze({
  region: ["020"],
  division: ["030"],
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
 * "ambiguous"` when a query means several kinds of place and no kind was given (ADR-003 §7),
 * or when exact matches of one kind sit in several states, none dominant, and no state was
 * given (#187). A trailing ", MO" / ", Missouri" in the query counts as the state.
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

  const suffix = splitStateSuffix(catalog, bounded);
  const stateFips = normalizeState(options.state) ?? suffix.state;
  const searchText = suffix.state ? suffix.name : bounded;
  const sumlevels = normalizeKind(options.kind);
  const normQuery = normalizeName(searchText);

  const searchOpts: { stateFips?: string; sumlevels?: string[]; limit: number } = { limit: 50 };
  if (stateFips) searchOpts.stateFips = stateFips;
  if (sumlevels) searchOpts.sumlevels = sumlevels;

  const rows = catalog.searchNames(searchText, searchOpts);
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
      const kinds = [...strongKinds].map(labelForSumlevel).join(", ");
      return {
        status: "ambiguous",
        candidates: flagAmbiguous(candidates),
        explanation: `"${query}" matches more than one kind of place (${kinds}). Specify a kind to choose.`,
      };
    }
  }

  // Ambiguity by state (#187): exact matches of the top kind in several states, none dominant.
  if (!stateFips) {
    const topKind = candidates[0]?.candidate.kind.sumlevel;
    const rivals = scored.filter(
      (c) => c.isExact && c.candidate.kind.sumlevel === topKind && c.candidate.stateFips !== null,
    );
    const states = [...new Set(rivals.map((c) => c.candidate.stateFips as string))];
    if (states.length > 1 && !hasDominantState(rivals)) {
      const label = topKind === undefined ? "place" : labelForSumlevel(topKind);
      const list = states.map((s) => FIPS_TO_USPS[s] ?? s).join(", ");
      return {
        status: "ambiguous",
        candidates: flagAmbiguous(candidates),
        explanation: `"${query}" matches a ${label} in more than one state (${list}). Specify a state to choose, e.g. "${searchText}, ${list.split(", ")[0]}".`,
      };
    }
  }

  return { status: "ok", candidates: candidates.map((c) => c.candidate) };
}

function flagAmbiguous(candidates: readonly Scored[]): PlaceCandidate[] {
  return candidates.map((c) => ({
    ...c.candidate,
    flags: c.candidate.flags.includes("ambiguous")
      ? c.candidate.flags
      : [...c.candidate.flags, "ambiguous" as const],
  }));
}

/** True when the most populous rival has STATE_DOMINANCE_RATIO× the best rival in any other state. */
function hasDominantState(rivals: readonly Scored[]): boolean {
  const byPop = [...rivals].sort(
    (a, b) => (b.candidate.population ?? 0) - (a.candidate.population ?? 0),
  );
  const lead = byPop[0];
  if (!lead || lead.candidate.population === null) return false;
  const runnerUp = byPop.find((c) => c.candidate.stateFips !== lead.candidate.stateFips);
  if (!runnerUp || runnerUp.candidate.population === null) return false;
  return lead.candidate.population >= STATE_DOMINANCE_RATIO * runnerUp.candidate.population;
}

/**
 * Splits a trailing ", MO" / ", Missouri" off a query into a state FIPS, when the tail is a
 * USPS code or matches a state in the catalog; otherwise the query is left whole.
 */
function splitStateSuffix(
  catalog: GeographyCatalog,
  query: string,
): { name: string; state?: string } {
  const m = /^(.+?),\s*([A-Za-z][A-Za-z .]{1,30})$/.exec(query.trim());
  const head = m?.[1]?.trim();
  const tail = m?.[2]?.trim();
  if (!head || !tail) return { name: query };
  if (/^[A-Za-z]{2}$/.test(tail)) {
    const fips = USPS_TO_FIPS[tail.toUpperCase()];
    return fips ? { name: head, state: fips } : { name: query };
  }
  const norm = normalizeName(tail);
  const hit = catalog
    .searchNames(tail, { sumlevels: ["040"], limit: 5 })
    .find((e) => normalizeName(e.name) === norm);
  if (!hit) return { name: query };
  return { name: head, state: hit.state_fips ?? hit.geoid };
}

/** A place's containment-hierarchy parents with shares (place → county → CBSA → state). */
export function getContainment(catalog: GeographyCatalog, ucgid: string): GeographyEdge[] {
  return catalog.parentsOf(ucgid).map(({ entity, share }) => edge(entity, share, "nests"));
}

/** A place's areal overlaps with allocation shares — e.g. a ZCTA's overlapping tracts. */
export function getOverlap(catalog: GeographyCatalog, ucgid: string): GeographyEdge[] {
  return catalog.overlapsOf(ucgid).map(({ entity, share }) => edge(entity, share, "overlaps"));
}

/** A tract's successors across vintages (2010 → 2020). */
export function getLineage(catalog: GeographyCatalog, ucgid: string): LineageEdge[] {
  return catalog.lineageFrom(ucgid);
}

/** Which programs publish for a place's level, and whether this place has each code. */
export function getAvailability(catalog: GeographyCatalog, ucgid: string): Availability[] {
  const e = catalog.getEntity(ucgid);
  if (!e) return [];
  return availabilityFor(catalog, e.sumlevel, catalog.agencyCodesOf(e.ucgid));
}

// --- internals ---------------------------------------------------------------

interface Scored {
  candidate: PlaceCandidate;
  score: number;
  isExact: boolean;
}

function scoreCandidate(catalog: GeographyCatalog, e: EntityRecord, normQuery: string): Scored {
  const aliases = catalog.aliasesOf(e.ucgid);
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

  const agencyCodes = catalog.agencyCodesOf(e.ucgid);
  const { flags, caveat } = deriveFlags(
    { geoid: e.geoid, sumlevel: e.sumlevel, name: e.name, lsad: e.lsad },
    agencyCodes,
    catalog.hasCountyChange(e.ucgid),
  );

  const candidate: PlaceCandidate = {
    geoid: e.geoid,
    ucgid: e.ucgid,
    dcid: dcidOf(e.sumlevel, e.geoid),
    name: e.name,
    kind: { sumlevel: e.sumlevel, label: labelForSumlevel(e.sumlevel) },
    stateFips: e.state_fips,
    parents: catalog.parentsOf(e.ucgid).map(({ entity }) => parent(entity)),
    agencyCodes,
    availableAt: availabilityFor(catalog, e.sumlevel, agencyCodes),
    flags,
    population: e.population,
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

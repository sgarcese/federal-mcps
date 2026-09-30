import type { EntityRecord, GeographyCatalog } from "./catalog.js";
import { deriveFlags } from "./flags.js";
import { dcidOf } from "./identifiers.js";
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
  nation: ["010"],
  country: ["010"],
  us: ["010"],
  region: ["020"],
  division: ["030"],
  state: ["040"],
  county: ["050"],
  city: ["160"],
  place: ["160"],
  // A "town" is a place in most states and a county subdivision in New England, New York and
  // Wisconsin; the town-twin fold below keeps a city and its same-municipality town one answer.
  town: ["160", "060"],
  township: ["060"],
  "county subdivision": ["060"],
  cousub: ["060"],
  mcd: ["060"],
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
  const sumlevels = normalizeKind(options.kind);
  // Below the trigram minimum only the nation's exact short aliases ("US") answer (#290).
  if (bounded.trim().length < 3) {
    const nation = nationMatches(
      catalog,
      normalizeName(bounded),
      sumlevels,
      normalizeState(options.state),
    );
    return {
      status: "ok",
      candidates: nation.map((e) => scoreCandidate(catalog, e, normalizeName(bounded)).candidate),
    };
  }

  // A bare place, county-subdivision or tract GEOID picks that entity (#241): the way out of a
  // same-name ambiguity when the caller has the id from an earlier answer.
  const bare = bounded.trim();
  if (/^(\d{7}|\d{10}|\d{11})$/.test(bare)) {
    const byId = catalog
      .entitiesByGeoid(bare)
      .filter((e) => !sumlevels || sumlevels.includes(e.sumlevel))
      .map((e) => scoreCandidate(catalog, e, normalizeName(bare)).candidate);
    if (byId.length > 0) return { status: "ok", candidates: byId };
  }

  const suffix = splitStateSuffix(catalog, bounded);
  const stateFips = normalizeState(options.state) ?? suffix.state;
  // "Cranberry, Butler County, PA": a county named before the state narrows the match (#241).
  const county = splitCountySuffix(suffix.state ? suffix.name : bounded);
  const searchText = county.name;
  const normQuery = normalizeName(searchText);

  const searchOpts: SearchOpts = { limit: 50 };
  if (stateFips) {
    searchOpts.stateFips = stateFips;
    const usps = FIPS_TO_USPS[stateFips];
    if (usps) searchOpts.stateUsps = usps;
  }
  if (sumlevels) searchOpts.sumlevels = sumlevels;

  const rows = withNation(
    nationMatches(catalog, normQuery, sumlevels, stateFips),
    searchSplittingTowns(catalog, searchText, searchOpts),
  );
  const folded = metrosAsFallback(
    foldTownTwins(rows.map((e) => scoreCandidate(catalog, e, normQuery))),
    stateFips !== undefined && !sumlevels,
  );
  // A dominated same-name town (isDominatedTown) ranks after every other match: a big rural
  // township's land area must not put it ahead of the city a name usually means (#241).
  const inCounty = county.county
    ? folded.filter((c) =>
        c.candidate.parents.some(
          (p) => p.kind.sumlevel === "050" && normalizeName(p.name) === county.county,
        ),
      )
    : folded;
  // A place dominated by a same-name state (#291) keeps its rank among the exact matches: it is
  // listed right after the state, only never the answer and never a reason to ask.
  const dominatedTowns = new Set(inCounty.filter((c) => isDominatedTown(c, inCounty)));
  const dominated = new Set([
    ...dominatedTowns,
    ...inCounty.filter((c) => isDominatedByState(c, inCounty)),
  ]);
  const tier = (c: Scored): number =>
    dominatedTowns.has(c) ? 3 : !c.isExact ? 2 : dominated.has(c) ? 1 : 0;
  const scored = inCounty.sort((a, b) => tier(a) - tier(b) || b.score - a.score);

  const limit = options.limit ?? 10;
  const candidates = scored.slice(0, limit);

  // Ambiguity: with no kind hint, if the strong (exact-name) matches span more than one
  // kind (city vs county vs metro), stop and let the caller choose.
  if (!options.kind) {
    const strongKinds = new Set(
      scored.filter((c) => c.isExact && !dominated.has(c)).map((c) => c.candidate.kind.sumlevel),
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

  // Ambiguity within a state (#241): same-name county subdivisions (Pennsylvania has two
  // Cranberry townships, dozens of Washington townships), none dominant — ask for the county.
  const sameStateTowns = sameStateTownRivals(scored);
  if (sameStateTowns) {
    return {
      status: "ambiguous",
      candidates: flagAmbiguous(candidates),
      explanation: townRivalsExplanation(query, searchText, sameStateTowns),
    };
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

/** The nation's summary level (#290). */
const NATION_SUMLEVEL = "010";

/**
 * The nation when the query is exactly one of its names or aliases (#290): a lookup, not a trigram
 * search, so a two-letter alias ("US") works and a page of places containing "nation" cannot
 * crowd it out. None under a state filter (the nation is in no state) or a kind that excludes it.
 */
function nationMatches(
  catalog: GeographyCatalog,
  normQuery: string,
  sumlevels: string[] | undefined,
  state: string | undefined,
): EntityRecord[] {
  if (state || (sumlevels && !sumlevels.includes(NATION_SUMLEVEL))) return [];
  return catalog
    .entitiesAtLevel(NATION_SUMLEVEL)
    .filter((e) =>
      [e.name, ...catalog.aliasesOf(e.ucgid)].some((n) => normalizeName(n) === normQuery),
    );
}

/** The nation's exact matches first, then the search rows without repeating them. */
function withNation(
  nation: readonly EntityRecord[],
  rows: readonly EntityRecord[],
): EntityRecord[] {
  if (nation.length === 0) return [...rows];
  const seen = new Set(nation.map((e) => e.ucgid));
  return [...nation, ...rows.filter((e) => !seen.has(e.ucgid))];
}

/**
 * Under a state filter with no kind, a metro answers only when nothing else matches exactly (#293):
 * "Denver-Aurora-Centennial, CO" finds the metro, while "Denver, CO" stays the city and county it
 * meant before metros could match a state.
 */
function metrosAsFallback(scored: Scored[], applies: boolean): Scored[] {
  if (!applies || !scored.some((c) => c.isExact && c.candidate.kind.sumlevel !== "310")) {
    return scored;
  }
  return scored.filter((c) => c.candidate.kind.sumlevel !== "310");
}

type SearchOpts = { stateFips?: string; stateUsps?: string; sumlevels?: string[]; limit: number };

/**
 * Searches county subdivisions apart from everything else (#241): a name like Springfield has more
 * same-name townships than one search page holds, and they must not crowd the cities out.
 */
function searchSplittingTowns(
  catalog: GeographyCatalog,
  text: string,
  opts: SearchOpts,
): EntityRecord[] {
  const wantsTowns = !opts.sumlevels || opts.sumlevels.includes("060");
  const others = opts.sumlevels?.filter((s) => s !== "060");
  if (!wantsTowns) return catalog.searchNames(text, opts);
  const towns = catalog.searchNames(text, { ...opts, sumlevels: ["060"] });
  if (others !== undefined && others.length === 0) return towns;
  const rest = catalog.searchNames(
    text,
    others ? { ...opts, sumlevels: others } : { ...opts, excludeSumlevels: ["060"] },
  );
  return [...rest, ...towns];
}

/**
 * The exact-match county subdivisions sharing the top candidate's name and state when none
 * dominates the next by STATE_DOMINANCE_RATIO× population (#241); undefined when the top
 * candidate is no county subdivision or one clearly leads.
 */
function sameStateTownRivals(scored: readonly Scored[]): Scored[] | undefined {
  const top = scored[0];
  if (!top || !top.isExact || top.candidate.kind.sumlevel !== "060") return undefined;
  const rivals = scored.filter(
    (c) =>
      c.isExact &&
      c.candidate.kind.sumlevel === "060" &&
      c.candidate.stateFips === top.candidate.stateFips,
  );
  if (rivals.length < 2) return undefined;
  const [lead, next] = [...rivals].sort(
    (a, b) => (b.candidate.population ?? 0) - (a.candidate.population ?? 0),
  );
  if (
    lead &&
    next &&
    (lead.candidate.population ?? 0) >= STATE_DOMINANCE_RATIO * (next.candidate.population ?? 0)
  )
    return undefined;
  return rivals;
}

/** A county subdivision's county, for an ambiguity explanation. */
function countyOf(c: Scored): string {
  return c.candidate.parents.find((p) => p.kind.sumlevel === "050")?.name ?? c.candidate.name;
}

/** How to choose among same-state towns: the county form of the query, or each town's GEOID. */
function townRivalsExplanation(query: string, name: string, rivals: readonly Scored[]): string {
  const usps = FIPS_TO_USPS[rivals[0]?.candidate.stateFips ?? ""] ?? "";
  const listed = rivals
    .slice(0, 10)
    .map((c) => `${countyOf(c)} ${c.candidate.geoid}`)
    .join(", ");
  const more = rivals.length > 10 ? `, and ${rivals.length - 10} more` : "";
  return (
    `"${query}" matches ${rivals.length} county subdivisions in ${usps || "one state"}. ` +
    `Choose by county, e.g. "${name}, ${countyOf(rivals[0] as Scored)}, ${usps}", or by GEOID: ${listed}${more}.`
  );
}

/** Splits a trailing ", Butler County" (or Parish, Borough, …) off a name; the county is normalized. */
function splitCountySuffix(text: string): { name: string; county?: string } {
  const m =
    /^(.+?),\s*([^,]+?\s(?:county|parish|borough|census area|planning region|municipality))$/i.exec(
      text.trim(),
    );
  if (!m?.[1] || !m[2]) return { name: text };
  return { name: m[1].trim(), county: normalizeName(m[2]) };
}

/**
 * Drops a county subdivision that is the same municipality as a place also in the results
 * (#241): Boston city (place) and Boston city (county subdivision) are one answer, not a choice.
 * The catalog links them with a place → town edge (geography-build `deriveTownTwins`), so the
 * town stays visible as the place's parent; a same-name town with no such edge is kept, and
 * the kind check below then reports the ambiguity.
 */
function foldTownTwins(scored: readonly Scored[]): Scored[] {
  const twinTowns = new Set<string>();
  for (const s of scored) {
    if (s.candidate.kind.sumlevel !== "160") continue;
    for (const p of s.candidate.parents) if (p.kind.sumlevel === "060") twinTowns.add(p.geoid);
  }
  if (twinTowns.size === 0) return [...scored];
  return scored.filter(
    (s) => !(s.candidate.kind.sumlevel === "060" && twinTowns.has(s.candidate.geoid)),
  );
}

function flagAmbiguous(candidates: readonly Scored[]): PlaceCandidate[] {
  return candidates.map((c) => ({
    ...c.candidate,
    flags: c.candidate.flags.includes("ambiguous")
      ? c.candidate.flags
      : [...c.candidate.flags, "ambiguous" as const],
  }));
}

/**
 * True for an exact county-subdivision match that a non-subdivision exact match outweighs by
 * STATE_DOMINANCE_RATIO× in population (#241): thousands of small townships share a city's name
 * (Boston, NY; Detroit township, IL), and none is a plausible reading of "Boston" or "Detroit".
 * A comparable town still makes the query ambiguous.
 */
function isDominatedTown(c: Scored, scored: readonly Scored[]): boolean {
  if (c.candidate.kind.sumlevel !== "060") return false;
  const lead = scored
    .filter((s) => s.isExact && s.candidate.kind.sumlevel !== "060")
    .reduce((max, s) => Math.max(max, s.candidate.population ?? 0), 0);
  return lead > 0 && lead >= STATE_DOMINANCE_RATIO * (c.candidate.population ?? 0);
}

/** True when the most populous rival has STATE_DOMINANCE_RATIO× the best rival in any other state. */
/**
 * True when an exact-name state has STATE_DOMINANCE_RATIO× this exact match's population (#291):
 * Colorado County, TX (20,700) neither wins nor makes "Colorado" ambiguous; New York city (the
 * state is 2.4× it) and Utah County (a fifth of Utah) still do, by the owner's ruling.
 */
function isDominatedByState(c: Scored, scored: readonly Scored[]): boolean {
  if (!c.isExact || c.candidate.kind.sumlevel === "040" || c.candidate.population === null) {
    return false;
  }
  const state = scored
    .filter((s) => s.isExact && s.candidate.kind.sumlevel === "040")
    .reduce((max, s) => Math.max(max, s.candidate.population ?? 0), 0);
  return state > 0 && state >= STATE_DOMINANCE_RATIO * c.candidate.population;
}

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
  // Larger places first (land area as a stand-in for population), gently. A county subdivision
  // ranks by population instead (#241) — rural townships are large in land and small in people —
  // which also keeps it below an equally matching incorporated place.
  score +=
    e.sumlevel === "060" ? Math.log10((e.population ?? 0) + 10) : Math.log10((e.aland ?? 1) + 10);
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
    // A "census"-keyed level (#294) is covered for every resolved place at it — the program
    // reads the Census GEOID/FIPS directly, with no catalog agency_code row to check.
    hasCode:
      p.keyed_by === "census" ||
      agencyCodes.some((c) => c.agency === p.agency && c.program === p.program),
    keyedBy: p.keyed_by,
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

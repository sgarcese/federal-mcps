import type {
  DimensionDefinition,
  GeographyCatalog,
  IndicatorDefinition,
  IndicatorFallback,
  IndicatorFetch,
  PlaceCandidate,
  SeriesFetchOptions,
  SeriesObservation,
  SeriesResult,
} from "@federal-mcps/core";
import {
  type BeaDataRow,
  type BeaResults,
  beaDataUrl,
  beaGetData,
  beaObservation,
} from "./bea-api.js";
import { beaMetroFallback, beaMetroFips, beaStateFips } from "./bea-geo.js";

/**
 * Regional price parities (#261, ADR-019 §2): one indicator, `regional_price_parity`, over three
 * BEA Regional tables — `MARPP` (metro, 387 CBSAs), `SARPP` (state) and `PARPP` (a state's
 * metropolitan/nonmetropolitan portion) — all sharing the same `item` line-code vocabulary
 * (verified live 2026-09-28 against `GetParameterValuesFiltered&TargetParameter=LineCode`: 1 all
 * items, 2 goods, 3 rents, 4 utilities, 5 other services, identical across all three tables).
 *
 * A county, city or town has no RPP series of its own (BEA publishes RPPs only for metros and
 * states): it answers with its containing metro (`beaMetroFallback`) when it has one. A place with
 * no metro — verified live: BEA additionally publishes `PARPP` "RPPs by portion", GeoFips
 * `<state FIPS>999` for a state's nonmetropolitan portion (and `<state FIPS>998` for its
 * metropolitan portion, unused here) — so this answers with the state's nonmetropolitan portion
 * instead of "unavailable": it is one extra call, unambiguous to build (the place's own
 * `stateFips`), and BEA states plainly what the number covers. The caveat says so, and says the
 * number is the whole state's nonmetro portion, not the place itself — important because a metro
 * this catalog does not yet know about would otherwise look identical to a truly nonmetro place.
 *
 * A resolved series key packs the table, the resolved line code and the GeoFips into one opaque
 * string (`buildRppKey`/`parseRppKey`) so `rppFetch`, given only the keys, can group several
 * places on the same table and line into ONE `beaGetData` call with a GeoFips list (verified live:
 * two MARPP metros in one call) rather than one call per place.
 */

const KEY_SEPARATOR = "|";

/** BEA's regional price parities start in 2008 (docs/spikes/m14-bea-regional.md, ADR-019 §2). */
const RPP_FLOOR_YEAR = 2008;

type RppTable = "MARPP" | "SARPP" | "PARPP";

const ITEM_VOCABULARY = [
  { code: "1", label: "all items" },
  { code: "2", label: "goods" },
  { code: "3", label: "rents" },
  { code: "4", label: "utilities" },
  { code: "5", label: "other services" },
] as const;

const ITEM_DIMENSION: DimensionDefinition = {
  argument: "item",
  description:
    "Regional price parity component: all items (default), goods, rents, utilities, or other services.",
  vocabulary: ITEM_VOCABULARY,
  default: "1",
};

/** The place's own RPP geography: a metro answers with MARPP, a state with SARPP; nothing else does. */
function rppAgencyCodeOf(place: PlaceCandidate): string | undefined {
  const metro = beaMetroFips(place);
  if (metro) return `metro:${metro}`;
  const state = beaStateFips(place);
  if (state) return `state:${state}`;
  return undefined;
}

/**
 * A county, city or town with no containing metro in the catalog answers with its state's
 * nonmetropolitan portion (`PARPP`, GeoFips `<state FIPS>999`) rather than "unavailable" — verified
 * live 2026-09-28: BEA publishes it, keyed by state FIPS alone, so it is unambiguous to build.
 */
function nonmetroPortionFallback(place: PlaceCandidate): IndicatorFallback | undefined {
  const level = place.kind.sumlevel;
  if (level !== "050" && level !== "160" && level !== "060") return undefined;
  const stateFips = place.stateFips;
  const stateName = place.parents.find((p) => p.kind.sumlevel === "040")?.name;
  if (!stateFips || !stateName) return undefined;
  const geoid = `${stateFips}999`;
  return {
    geoid,
    name: `${stateName} (Nonmetropolitan Portion)`,
    sumlevel: "040",
    code: `portion:${geoid}`,
    caveat:
      `BEA publishes regional price parities for metropolitan areas and states; ${place.name} ` +
      `is not resolved to a metropolitan area in this catalog. This answer is ${stateName}'s ` +
      "nonmetropolitan portion (BEA table PARPP, the whole state outside its metro areas), not a " +
      `figure specific to ${place.name} — it may be a real metro area this catalog does not yet cover.`,
  };
}

/** A county, city or town answers with its metro, or — lacking one — its state's nonmetro portion. */
function rppFallback(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
): IndicatorFallback | undefined {
  const metro = beaMetroFallback(catalog, place, "regional price parities");
  if (metro) return { ...metro, code: `metro:${metro.code}` };
  return nonmetroPortionFallback(place);
}

/** Only reached when even the nonmetro-portion fallback cannot be built (no known state FIPS). */
function rppUnavailableNote(place: PlaceCandidate): string | undefined {
  return (
    "BEA publishes regional price parities for metropolitan areas and states; " +
    `${place.name}'s state could not be determined, so not even its nonmetropolitan portion can be reported.`
  );
}

interface ParsedCode {
  kind: "metro" | "state" | "portion";
  geoFips: string;
}

function parseCode(code: string): ParsedCode | undefined {
  const [kind, geoFips] = code.split(":");
  if ((kind !== "metro" && kind !== "state" && kind !== "portion") || !geoFips) return undefined;
  return { kind, geoFips };
}

function tableFor(kind: ParsedCode["kind"]): RppTable {
  if (kind === "metro") return "MARPP";
  if (kind === "state") return "SARPP";
  return "PARPP";
}

/** Encode the table (from the resolved geography kind), the resolved item code and the GeoFips. */
function buildRppKey(code: string, item: string): string {
  const parsed = parseCode(code);
  if (!parsed) return code;
  return [tableFor(parsed.kind), item, parsed.geoFips].join(KEY_SEPARATOR);
}

interface ParsedKey {
  table: RppTable;
  line: string;
  geoFips: string;
}

function parseRppKey(key: string): ParsedKey | undefined {
  const [table, line, geoFips] = key.split(KEY_SEPARATOR);
  if ((table !== "MARPP" && table !== "SARPP" && table !== "PARPP") || !line || !geoFips) {
    return undefined;
  }
  return { table, line, geoFips };
}

/**
 * The Year parameter for one fetch (shared by every series in the batch, ADR-019 §2): omitted for
 * "latest" (BEA's own default, LAST5 — `rppFetch` keeps only the newest observation from it per
 * key unless years were asked for), or the explicit range floored at 2008, newest year first. A
 * range entirely before 2008 fetches nothing, with a note, rather than a call BEA would reject.
 */
function yearsFor(
  options: SeriesFetchOptions,
): { skip: true; note: string } | { skip: false; year?: string; note?: string } {
  if (!options.explicitYears) return { skip: false };
  const endYear = options.endYear ?? options.startYear;
  let startYear = options.startYear ?? endYear;
  if (startYear === undefined || endYear === undefined) return { skip: false };
  if (endYear < RPP_FLOOR_YEAR) {
    return {
      skip: true,
      note: `BEA publishes regional price parities from ${RPP_FLOOR_YEAR}; none of the requested ${startYear}–${endYear} range is published.`,
    };
  }
  let note: string | undefined;
  if (startYear < RPP_FLOOR_YEAR) {
    note = `BEA publishes regional price parities from ${RPP_FLOOR_YEAR}; the range was started there instead of ${startYear}.`;
    startYear = RPP_FLOOR_YEAR;
  }
  const years: number[] = [];
  for (let y = endYear; y >= startYear; y--) years.push(y);
  return { skip: false, year: years.join(","), ...(note ? { note } : {}) };
}

/** BEA's own notes worth keeping verbatim: the OMB metro delineation (MARPP/PARPP) and the release vintage. */
function rppNotes(results: BeaResults): string[] {
  const notes: string[] = [];
  const delineation = results.Notes?.find((n) =>
    /Metropolitan Areas are defined/i.test(n.NoteText),
  );
  if (delineation) notes.push(`BEA: ${delineation.NoteText.trim()}`);
  const updated = results.Notes?.find((n) => /^Last updated/i.test(n.NoteText.trim()));
  if (updated) notes.push(`BEA: ${updated.NoteText.trim()}`);
  return notes;
}

/**
 * Fetch every requested RPP series (ADR-019 §2): groups keys sharing a table and line code into
 * one `beaGetData` call with every distinct GeoFips (verified live: two MARPP metros in one call),
 * so `bea_compare_places` costs one upstream call per table/line rather than one per place.
 * Observations come back newest year first (BEA returns them ascending); a suppressed or missing
 * cell is `beaObservation`'s null, never a fabricated number.
 */
const rppFetch: IndicatorFetch = async (client, seriesIds, options) => {
  const parsedByKey = new Map<string, ParsedKey>();
  for (const key of seriesIds) {
    const parsed = parseRppKey(key);
    if (parsed) parsedByKey.set(key, parsed);
  }

  const yearPlan = yearsFor(options);
  if (yearPlan.skip) {
    return seriesIds.map((key) => ({ seriesId: key, observations: [], notes: [yearPlan.note] }));
  }

  const groups = new Map<
    string,
    { table: RppTable; line: string; keys: string[]; geoFipsList: string[] }
  >();
  for (const [key, parsed] of parsedByKey) {
    const groupKey = `${parsed.table}|${parsed.line}`;
    const group = groups.get(groupKey) ?? {
      table: parsed.table,
      line: parsed.line,
      keys: [],
      geoFipsList: [],
    };
    group.keys.push(key);
    if (!group.geoFipsList.includes(parsed.geoFips)) group.geoFipsList.push(parsed.geoFips);
    groups.set(groupKey, group);
  }

  const resultsByKey = new Map<string, SeriesResult>();
  for (const group of groups.values()) {
    const results = await beaGetData(
      client,
      {
        table: group.table,
        lineCode: group.line,
        geoFips: group.geoFipsList,
        ...(yearPlan.year !== undefined ? { year: yearPlan.year } : {}),
      },
      options.apiKey,
    );
    const notes = [...(yearPlan.note ? [yearPlan.note] : []), ...rppNotes(results)];
    const rowsByGeoFips = new Map<string, BeaDataRow[]>();
    for (const row of results.Data ?? []) {
      const list = rowsByGeoFips.get(row.GeoFips) ?? [];
      list.push(row);
      rowsByGeoFips.set(row.GeoFips, list);
    }
    for (const key of group.keys) {
      const parsed = parsedByKey.get(key);
      const rows = parsed ? (rowsByGeoFips.get(parsed.geoFips) ?? []) : [];
      const observations: SeriesObservation[] = rows
        .map((row) => beaObservation(row, results.Notes))
        .sort((a, b) => (a.year === b.year ? 0 : a.year < b.year ? 1 : -1));
      resultsByKey.set(key, {
        seriesId: key,
        observations,
        ...(notes.length > 0 ? { notes } : {}),
      });
    }
  }

  return seriesIds.map((key) => resultsByKey.get(key) ?? { seriesId: key, observations: [] });
};

/** Where an RPP answer actually read (#212): the exact key-less GetData URL, and a readable label. */
function rppSourceOf(
  key: string,
  latest: SeriesObservation | undefined,
): { url: string; label: string } | undefined {
  const parsed = parseRppKey(key);
  if (!parsed) return undefined;
  const itemLabel =
    ITEM_VOCABULARY.find((v) => v.code === parsed.line)?.label ?? `line ${parsed.line}`;
  const year = latest?.year;
  const url = beaDataUrl({
    table: parsed.table,
    lineCode: parsed.line,
    geoFips: parsed.geoFips,
    ...(year ? { year } : {}),
  });
  return {
    url,
    label: `${parsed.table} line ${parsed.line} (${itemLabel}), GeoFips ${parsed.geoFips}${year ? `, ${year}` : ""}`,
  };
}

/** Regional price parities (ADR-019 §2): metro (MARPP), state (SARPP), with the `item` picker. */
export const rppIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "regional_price_parity",
    program: "RPP",
    description:
      "BEA regional price parity: a cost-of-living index for a metro area or state (U.S. = 100), for all items, goods, rents, utilities or other services. A county, city or town answers with its metro area, or — if it has none — its state's nonmetropolitan portion.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: rppAgencyCodeOf,
    buildSeriesId: (code, { dimensions }) => buildRppKey(code, dimensions.item ?? "1"),
    dimensions: [ITEM_DIMENSION],
    fallback: rppFallback,
    unavailableNote: rppUnavailableNote,
    fetch: rppFetch,
    sourceOf: rppSourceOf,
  },
];

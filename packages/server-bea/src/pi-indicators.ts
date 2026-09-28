import type {
  DimensionDefinition,
  IndicatorDefinition,
  IndicatorFetch,
  PlaceCandidate,
  SeriesObservation,
  SeriesResult,
} from "@federal-mcps/core";
import { beaDataUrl, beaGetData, beaObservation, unitOf, vintageNote } from "./bea-api.js";
import {
  beaCountyFallback,
  beaCountyFips,
  beaStateFips,
  combinationCaveat,
  connecticutNote,
} from "./bea-geo.js";

/**
 * Personal income and per capita personal income (#259, ADR-019 §2, §5, §6, §8): county from
 * `CAINC1`, state from `SAINC1`, and state quarterly from `SQINC1` via the `frequency` dimension
 * (default `annual`). Codes come from `bea-geo.ts` only — county (including Virginia combinations),
 * state `SS000`; a city or town falls back to its county (`beaCountyFallback`). Metros are out of
 * scope for this family: BEA's county tables error on metro codes (docs/spikes/m14-bea-regional.md).
 *
 * A series key is `<table>|<lineCode>|<geoFips>|<frequency>`, opaque to the tool layer: `piFetch`
 * groups keys sharing a table and line code into ONE `beaGetData` call with a `GeoFips` list (ADR-019
 * §2, "compare batching"). Quarterly is state-only: a county key asking `quarterly` is tagged with
 * the sentinel table below at build time, so `piFetch` answers it with no observation and a clear
 * note instead of ever silently substituting the annual figure.
 */

const PROGRAM = "PI";
const KEY_SEP = "|";

/** Sentinel table for "quarterly asked of a county": BEA has no such series (SQINC1 is state-only). */
const COUNTY_QUARTERLY_UNAVAILABLE = "COUNTY_QUARTERLY_UNAVAILABLE";

const FREQUENCY_DIMENSION: DimensionDefinition = {
  argument: "frequency",
  description:
    "annual (default) or quarterly; BEA publishes quarterly personal income for states only.",
  vocabulary: [
    { code: "annual", label: "annual" },
    { code: "quarterly", label: "quarterly (states only)" },
  ],
  default: "annual",
};

/** A state GeoFips is `SS000`; anything else (a county, or a Virginia/Hawaii combination) is not. */
function isStateGeoFips(geoFips: string): boolean {
  return /^\d{2}000$/.test(geoFips);
}

/** Which BEA table answers `geoFips` at `frequency`; the sentinel when the combination is invalid. */
function tableFor(geoFips: string, frequency: string): string {
  const state = isStateGeoFips(geoFips);
  if (frequency === "quarterly") return state ? "SQINC1" : COUNTY_QUARTERLY_UNAVAILABLE;
  return state ? "SAINC1" : "CAINC1";
}

function buildPiKey(lineCode: number, geoFips: string, frequency: string): string {
  return [tableFor(geoFips, frequency), lineCode, geoFips, frequency].join(KEY_SEP);
}

interface ParsedPiKey {
  table: string;
  lineCode: string;
  geoFips: string;
  frequency: string;
}

function parsePiKey(key: string): ParsedPiKey | undefined {
  const [table, lineCode, geoFips, frequency] = key.split(KEY_SEP);
  if (!table || !lineCode || !geoFips || !frequency) return undefined;
  return { table, lineCode, geoFips, frequency };
}

/** A county's or state's GeoFips (`bea-geo.ts`); metros are out of scope for this family. */
function piAgencyCodeOf(place: PlaceCandidate): string | undefined {
  return beaCountyFips(place) ?? beaStateFips(place);
}

/** BEA does not publish personal income by metropolitan area (ADR-019 §2). */
function piUnavailableNote(place: PlaceCandidate): string | undefined {
  return place.kind.sumlevel === "310"
    ? "BEA does not publish personal income or per capita personal income by metropolitan area; ask for a county or state instead."
    : undefined;
}

/** The years to request, as BEA wants them: explicit → the whole range; none → BEA's own default. */
function yearsFor(options: {
  startYear?: number;
  endYear?: number;
  explicitYears?: boolean;
}): readonly number[] | undefined {
  if (!options.explicitYears) return undefined;
  const endYear = options.endYear ?? options.startYear;
  const startYear = options.startYear ?? endYear;
  if (startYear === undefined || endYear === undefined) return undefined;
  // Ascending, so the query string (and its fixture hash) is independent of which end the caller
  // gave first; `piFetch` sorts observations newest-first itself.
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  return years;
}

/** Sort key for newest-first ordering: quarters within a year sort after that year's annual row. */
function periodSortKey(o: SeriesObservation): number {
  const q = /^Q0?(\d)$/.exec(o.period);
  return Number(o.year) * 10 + (q?.[1] ? Number(q[1]) : 0);
}

/**
 * The PI fetch capability (#259): groups series keys by table+line code so every place sharing an
 * indicator and frequency is answered in ONE `beaGetData` call with a `GeoFips` list. A county key
 * asking quarterly never reaches BEA — it is answered with no observation and a note, never a
 * silently substituted annual figure. Every group's answer carries `vintageNote`, the row's own
 * unit, and (for a Connecticut planning region) `connecticutNote` when earlier years were asked for.
 */
const piFetch: IndicatorFetch = async (client, seriesIds, options): Promise<SeriesResult[]> => {
  const parsedById = new Map<string, ParsedPiKey>();
  const unavailable = new Map<string, string>();
  const groups = new Map<string, { table: string; lineCode: string; ids: string[] }>();

  for (const id of seriesIds) {
    const parsed = parsePiKey(id);
    if (!parsed) continue;
    parsedById.set(id, parsed);
    if (parsed.table === COUNTY_QUARTERLY_UNAVAILABLE) {
      unavailable.set(
        id,
        `BEA publishes quarterly personal income for states only; GeoFips ${parsed.geoFips} is not a state, so no quarterly figure is shown. Ask for frequency "annual", or a state, for quarterly data.`,
      );
      continue;
    }
    const groupKey = `${parsed.table}${KEY_SEP}${parsed.lineCode}`;
    const group = groups.get(groupKey) ?? {
      table: parsed.table,
      lineCode: parsed.lineCode,
      ids: [],
    };
    group.ids.push(id);
    groups.set(groupKey, group);
  }

  const resultById = new Map<string, SeriesResult>();
  const years = yearsFor(options);
  for (const group of groups.values()) {
    const geoFipsList = group.ids.map((id) => parsedById.get(id)?.geoFips ?? "");
    const results = await beaGetData(
      client,
      {
        table: group.table,
        lineCode: group.lineCode,
        geoFips: geoFipsList,
        ...(years ? { year: years } : {}),
      },
      options.apiKey,
    );
    const vNote = vintageNote(results);
    for (const id of group.ids) {
      const parsed = parsedById.get(id);
      if (!parsed) continue;
      const rows = (results.Data ?? []).filter((r) => r.GeoFips === parsed.geoFips);
      let observations = rows.map((r) => beaObservation(r, results.Notes));
      observations = observations.sort((a, b) => periodSortKey(b) - periodSortKey(a));
      if (!options.explicitYears) observations = observations.slice(0, 1);
      const seriesNotes: string[] = [];
      if (vNote) seriesNotes.push(vNote);
      const unitRow = rows[0];
      if (unitRow) seriesNotes.push(`Unit: ${unitOf(unitRow, results)}.`);
      const ctNote = connecticutNote(parsed.geoFips, options.startYear);
      if (ctNote) seriesNotes.push(ctNote);
      resultById.set(id, {
        seriesId: id,
        observations,
        ...(seriesNotes.length > 0 ? { notes: seriesNotes } : {}),
      });
    }
  }

  return seriesIds.map(
    (id) =>
      resultById.get(id) ?? {
        seriesId: id,
        observations: [],
        ...(unavailable.has(id) ? { notes: [unavailable.get(id) as string] } : {}),
      },
  );
};

/** Where a PI answer actually read (#212): the exact GetData URL, key-less. */
function piSourceOf(
  key: string,
  latest: SeriesObservation | undefined,
): { url: string; label: string } | undefined {
  const parsed = parsePiKey(key);
  if (!parsed || parsed.table === COUNTY_QUARTERLY_UNAVAILABLE) return undefined;
  const year = latest
    ? latest.period.startsWith("Q")
      ? `${latest.year}${latest.period.replace("Q0", "Q")}`
      : latest.year
    : undefined;
  const url = beaDataUrl({
    table: parsed.table,
    lineCode: parsed.lineCode,
    geoFips: parsed.geoFips,
    ...(year ? { year } : {}),
  });
  return {
    url,
    label: `${parsed.table} line ${parsed.lineCode}, GeoFips ${parsed.geoFips}${year ? `, ${year}` : ""}`,
  };
}

function definitionFor(
  name: string,
  lineCode: number,
  label: string,
  description: string,
): IndicatorDefinition {
  return {
    name,
    program: PROGRAM,
    description,
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: piAgencyCodeOf,
    buildSeriesId: (code, { dimensions }) =>
      buildPiKey(lineCode, code, dimensions.frequency ?? "annual"),
    dimensions: [FREQUENCY_DIMENSION],
    caveatOf: (place) => combinationCaveat(place),
    fallback: (catalog, place) => beaCountyFallback(catalog, place, label),
    unavailableNote: piUnavailableNote,
    fetch: piFetch,
    sourceOf: piSourceOf,
  };
}

/** Personal income and per capita personal income (ADR-019 §2, §5, §6, §8). */
export const piIndicatorDefinitions: IndicatorDefinition[] = [
  definitionFor(
    "personal_income",
    1,
    "personal income",
    "Total personal income by place, in current dollars (BEA CAINC1 county / SAINC1 state / SQINC1 state quarterly, line 1).",
  ),
  definitionFor(
    "per_capita_personal_income",
    3,
    "per capita personal income",
    "Per capita personal income by place, in current dollars (BEA CAINC1 county / SAINC1 state / SQINC1 state quarterly, line 3).",
  ),
];

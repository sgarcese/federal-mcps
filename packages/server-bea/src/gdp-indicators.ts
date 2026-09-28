import type {
  DimensionDefinition,
  DimensionSelection,
  GeographyCatalog,
  HttpClient,
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
  beaDataUrl,
  beaGetData,
  beaObservation,
  unitOf,
  vintageNote,
} from "./bea-api.js";
import {
  beaCountyFallback,
  beaCountyFips,
  beaStateFips,
  combinationCaveat,
  connecticutNote,
} from "./bea-geo.js";

import VENDORED_GDP_LINES from "./data/gdp-lines.json" with { type: "json" };
/**
 * GDP and real GDP by industry (#260, ADR-019 §2, §5): county (`CAGDP2` current dollars, `CAGDP9`
 * chained 2017 dollars) and state (`SAGDP2`, `SAGDP9`) — the `industry` picker resolves to each
 * table's own BEA LineCode, built from a vendored line list
 * (`data/gdp-lines.json`, `scripts/generate-gdp-lines.mts`) rather than a typed table, per
 * CLAUDE.md's "series and variable IDs are built, not typed."
 *
 * Verified 2026-09-28 (`scripts/generate-gdp-lines.mts`'s output): every one of `CAGDP2`/`CAGDP9`'s
 * 34 industry lines exists under the SAME LineCode in `SAGDP2`/`SAGDP9`, with the identical NAICS
 * parenthetical in BEA's own description — no mismatches across the 34 common lines. So one
 * `industry` vocabulary (built from the county tables, the more restrictive pair) maps to the right
 * LineCode on whichever of the four tables a place resolves to; the state tables additionally carry
 * ~60 lines (overseas-activity and government breakouts) the county tables do not, which this
 * vocabulary leaves out since they have no county-level equivalent to keep the two levels aligned.
 *
 * A series key packs the table, the resolved LineCode, and the place's GeoFips:
 * `${table}|${lineCode}|${geoFips}` — the table already says current vs. real and county vs. state
 * (`gdpFetch` never has to re-derive it), so `bea_compare_places` groups every key sharing a table
 * and LineCode into ONE `beaGetData` call with a GeoFips list (ADR-019 §5's compare batching), and
 * splits the response's rows back out by `GeoFips`.
 */

const KEY_SEPARATOR = "|";

/** The four GDP-by-industry tables (ADR-019 §2, §5). */
const TABLES = ["CAGDP2", "CAGDP9", "SAGDP2", "SAGDP9"] as const;
type GdpTable = (typeof TABLES)[number];

function isGdpTable(value: string): value is GdpTable {
  return (TABLES as readonly string[]).includes(value);
}

/** BEA publishes county GDP by industry from this year on (ADR-019 §2); state goes back further. */
const COUNTY_FLOOR_YEAR = 2001;

interface GdpLineRow {
  readonly code: string;
  readonly label: string;
  readonly naics: string | null;
}
type GdpLines = Record<GdpTable, readonly GdpLineRow[]>;

/**
 * The vendored line list (`data/gdp-lines.json`, `generate-gdp-lines.mts`), imported statically so
 * the compiler emits it with the package and esbuild inlines it into the Lambda bundle — never read
 * from disk at runtime (#260).
 */
function loadGdpLines(): GdpLines {
  return VENDORED_GDP_LINES as GdpLines;
}

/** The `industry` vocabulary: every county-table line with a NAICS code, plus `all` and `private`. */
function buildIndustryVocabulary(lines: GdpLines): { code: string; label: string }[] {
  const rows = lines.CAGDP2.filter((r) => r.naics !== null);
  return [
    { code: "all", label: "All industry total" },
    { code: "private", label: "Private industries" },
    ...rows.map((r) => ({ code: r.naics as string, label: r.label })),
  ];
}

const GDP_LINES = loadGdpLines();

const GDP_INDUSTRY_DIMENSION: DimensionDefinition = {
  argument: "industry",
  description:
    "Industry sector by NAICS code (e.g. 23 construction, 31-33 manufacturing), or 'all' (default, the all-industry total) / 'private' (private industries).",
  vocabulary: buildIndustryVocabulary(GDP_LINES),
  default: "all",
};

/** BEA's own LineCode for an `industry` vocabulary code, on `table` (ADR-019 §5's built-not-typed rule). */
function lineCodeOf(table: GdpTable, industry: string): string | undefined {
  if (industry === "all") return "1";
  if (industry === "private") return "2";
  return GDP_LINES[table].find((r) => r.naics === industry)?.code;
}

/** True for a GeoFips BEA publishes at the state level: `SS000` (`beaStateFips`'s own shape). */
function isStateGeoFips(geoFips: string): boolean {
  return geoFips.length === 5 && geoFips.endsWith("000");
}

/** Current-dollar `CAGDP2`/`SAGDP2` or chained-2017-dollar `CAGDP9`/`SAGDP9`, by geography level. */
function tableFor(real: boolean, geoFips: string): GdpTable {
  const state = isStateGeoFips(geoFips);
  if (real) return state ? "SAGDP9" : "CAGDP9";
  return state ? "SAGDP2" : "CAGDP2";
}

/** A county's GeoFips (its combination code when BEA combines it) or a state's `SS000`. */
function gdpAgencyCodeOf(place: PlaceCandidate): string | undefined {
  return beaCountyFips(place) ?? beaStateFips(place);
}

/** A city or town falls back to its county (BEA publishes GDP by county, not by city or town). */
function gdpFallback(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
): IndicatorFallback | undefined {
  return beaCountyFallback(catalog, place, "GDP and real GDP by industry");
}

/** The Virginia-combination / Kalawao-Maui caveat for a direct county answer. */
function gdpCaveatOf(place: PlaceCandidate, _dimensions: DimensionSelection): string | undefined {
  return combinationCaveat(place);
}

function buildGdpKey(real: boolean, geoFips: string, industry: string): string {
  const table = tableFor(real, geoFips);
  const lineCode = lineCodeOf(table, industry) ?? "1";
  return [table, lineCode, geoFips].join(KEY_SEPARATOR);
}

function parseGdpKey(
  key: string,
): { table: GdpTable; lineCode: string; geoFips: string } | undefined {
  const [table, lineCode, geoFips] = key.split(KEY_SEPARATOR);
  if (!table || !lineCode || !geoFips || !isGdpTable(table)) return undefined;
  return { table, lineCode, geoFips };
}

/**
 * The years to ask BEA for, newest first: omitted (BEA's own default, `LAST5`) unless the caller
 * gave an explicit range, floored at 2001 for the county tables (state goes back further; BEA
 * itself is the floor there). `notes` collects the floor caveat when it bites.
 */
function yearsToFetch(
  table: GdpTable,
  options: SeriesFetchOptions,
  notes: string[],
): readonly string[] | undefined {
  if (!options.explicitYears) return undefined;
  const endYear = options.endYear ?? options.startYear;
  let startYear = options.startYear ?? endYear;
  if (startYear === undefined || endYear === undefined) return undefined;
  if (table.startsWith("CA") && startYear < COUNTY_FLOOR_YEAR) {
    notes.push(
      `BEA publishes county GDP by industry from ${COUNTY_FLOOR_YEAR}; the range was started there instead of ${startYear}.`,
    );
    startYear = COUNTY_FLOOR_YEAR;
  }
  const years: string[] = [];
  for (let y = endYear; y >= startYear; y--) years.push(String(y));
  return years;
}

/** Newest-first: by year, then (for the rare quarterly period code) by period. */
function newestFirst(a: SeriesObservation, b: SeriesObservation): number {
  return Number(b.year) - Number(a.year) || b.period.localeCompare(a.period);
}

/**
 * One group's `beaGetData` call — every key sharing a table and LineCode, batched into a single
 * call with every place's GeoFips (ADR-019 §5) — split back into a `SeriesResult` per key. A
 * `(D)`/`(NA)` cell becomes a null value with BEA's note (`beaObservation`), never zero; a GeoFips
 * BEA returns no row for becomes an empty series with a note, never a guess.
 */
async function fetchGroup(
  client: HttpClient,
  table: GdpTable,
  lineCode: string,
  geoFipsToKeys: ReadonlyMap<string, readonly string[]>,
  options: SeriesFetchOptions,
  results: Map<string, SeriesResult>,
): Promise<void> {
  const rangeNotes: string[] = [];
  const years = yearsToFetch(table, options, rangeNotes);
  const geoFipsList = [...geoFipsToKeys.keys()];
  const beaResults = await beaGetData(
    client,
    { table, lineCode, geoFips: geoFipsList, ...(years ? { year: years } : {}) },
    options.apiKey,
  );
  const rowsByGeo = new Map<string, BeaDataRow[]>();
  for (const row of beaResults.Data ?? []) {
    const list = rowsByGeo.get(row.GeoFips) ?? [];
    list.push(row);
    rowsByGeo.set(row.GeoFips, list);
  }
  const vintage = vintageNote(beaResults);
  const isReal = table.endsWith("9");

  for (const [geoFips, keysForGeo] of geoFipsToKeys) {
    const rows = rowsByGeo.get(geoFips) ?? [];
    const observations = rows.map((row) => beaObservation(row, beaResults.Notes)).sort(newestFirst);
    const notes = [...rangeNotes];
    if (vintage) notes.push(vintage);
    const firstRow = rows[0];
    if (firstRow) notes.push(`Unit: ${unitOf(firstRow, beaResults)}.`);
    if (rows.length === 0) {
      notes.push(
        `BEA ${table} has no data for GeoFips ${geoFips}${years ? ` for ${years.join(", ")}` : ""}.`,
      );
    }
    if (isReal) {
      notes.push(
        "Real GDP is chain-weighted (2017 dollars); never sum it across industries or across places.",
      );
    }
    const ct = connecticutNote(geoFips, options.explicitYears ? options.startYear : undefined);
    if (ct) notes.push(ct);
    for (const key of keysForGeo) {
      results.set(key, { seriesId: key, observations, ...(notes.length > 0 ? { notes } : {}) });
    }
  }
}

/**
 * The GDP fetch capability (#260, ADR-019 §5): groups every requested key by table + LineCode, one
 * `beaGetData` call per group (the compare-batching rule), splitting the response's rows back out
 * by GeoFips.
 */
const gdpFetch: IndicatorFetch = async (client, keys, options): Promise<SeriesResult[]> => {
  const results = new Map<string, SeriesResult>();
  const groups = new Map<
    string,
    { table: GdpTable; lineCode: string; geoFipsToKeys: Map<string, string[]> }
  >();
  for (const key of keys) {
    const parsed = parseGdpKey(key);
    if (!parsed) {
      results.set(key, { seriesId: key, observations: [], notes: ["malformed GDP series key"] });
      continue;
    }
    const groupKey = `${parsed.table}${KEY_SEPARATOR}${parsed.lineCode}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { table: parsed.table, lineCode: parsed.lineCode, geoFipsToKeys: new Map() };
      groups.set(groupKey, group);
    }
    const forGeo = group.geoFipsToKeys.get(parsed.geoFips) ?? [];
    forGeo.push(key);
    group.geoFipsToKeys.set(parsed.geoFips, forGeo);
  }
  for (const group of groups.values()) {
    await fetchGroup(client, group.table, group.lineCode, group.geoFipsToKeys, options, results);
  }
  return keys.map((key) => results.get(key) ?? { seriesId: key, observations: [] });
};

/** Where a GDP answer actually read (#212): the exact key-less GetData URL, with a readable label. */
function gdpSourceOf(
  key: string,
  latest: SeriesObservation | undefined,
): { url: string; label: string } | undefined {
  const parsed = parseGdpKey(key);
  if (!parsed) return undefined;
  const url = beaDataUrl({
    table: parsed.table,
    lineCode: parsed.lineCode,
    geoFips: parsed.geoFips,
    ...(latest?.year ? { year: latest.year } : {}),
  });
  const lineLabel =
    GDP_LINES[parsed.table].find((r) => r.code === parsed.lineCode)?.label ??
    `line ${parsed.lineCode}`;
  return { url, label: `BEA ${parsed.table}: ${lineLabel}, GeoFips ${parsed.geoFips}` };
}

/** GDP and real GDP by industry (ADR-019 §2, §5): county (CAGDP2/CAGDP9) and state (SAGDP2/SAGDP9). */
export const gdpIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "gdp",
    program: "GDP",
    description:
      "BEA gross domestic product by industry, in current dollars: county (CAGDP2) or state (SAGDP2), by NAICS sector (the industry argument).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: gdpAgencyCodeOf,
    buildSeriesId: (code, { dimensions }) => buildGdpKey(false, code, dimensions.industry ?? "all"),
    dimensions: [GDP_INDUSTRY_DIMENSION],
    caveatOf: gdpCaveatOf,
    fallback: gdpFallback,
    fetch: gdpFetch,
    sourceOf: gdpSourceOf,
  },
  {
    name: "real_gdp",
    program: "GDP",
    description:
      "BEA real gross domestic product by industry, in chained 2017 dollars: county (CAGDP9) or state (SAGDP9), by NAICS sector (the industry argument). Chain-weighted: never sum across industries or places.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: gdpAgencyCodeOf,
    buildSeriesId: (code, { dimensions }) => buildGdpKey(true, code, dimensions.industry ?? "all"),
    dimensions: [GDP_INDUSTRY_DIMENSION],
    caveatOf: gdpCaveatOf,
    fallback: gdpFallback,
    fetch: gdpFetch,
    sourceOf: gdpSourceOf,
  },
];

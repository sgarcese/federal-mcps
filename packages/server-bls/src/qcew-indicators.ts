import type { HttpClient, PlaceCandidate } from "@federal-mcps/core";
import {
  fetchQcewRow,
  INDUSTRY_ALL,
  latestPublishedQuarter,
  OWN_TOTAL_COVERED,
  priorQuarter,
  type QcewHeadline,
  type QcewRowSelection,
  qcewDisclosureText,
} from "./qcew.js";
import type { DimensionDefinition, IndicatorDefinition } from "./registry.js";
import type { IndicatorFetch, SeriesObservation, SeriesResult } from "./series-fetch.js";

/**
 * QCEW registered as indicators (ADR-011 §1, §3, §4; ADR-013 §2) using the fetch-capability seam
 * (#123) over the CSV client (#124). County and state resolve to their QCEW area code from the
 * GEOID; the opaque "series key" (ADR-011 §2) encodes the area plus the chosen ownership and
 * industry as `${area}|${ownership}|${industry}` (default `${area}|0|10`, the total-covered,
 * all-industries headline). The fetch capability parses the key, fetches the area's latest
 * published quarter (unchanged, cached by area+quarter only — the row picked from it is a later
 * step), and picks the row by own_code, industry_code and the matching agglvl_code (`qcew.ts`).
 * Suppressed cells travel as a footnote with a null value — never fabricated; a selection with no
 * unique matching row (e.g. QCEW does not publish a total-ownership row at the sector level)
 * likewise returns no observation rather than a guess. Metro (the QCEW `C`-code) is a follow-up.
 */
const QCEW_PROGRAM = "QCEW";
const COUNTY_SUMLEVEL = "050";
const STATE_SUMLEVEL = "040";
/** A quarter is fixed once released, so cache the slice for 30 days. */
const QCEW_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
/** How many quarters to walk back if the newest expected slice isn't published yet. */
const QCEW_MAX_LOOKBACK = 3;
/** Separates the area, ownership and industry codes in the opaque series key. */
const KEY_SEPARATOR = "|";

/** The QCEW area code for a place: county = 5-digit FIPS, state = SS000. Undefined otherwise. */
export function qcewAreaCodeOf(place: PlaceCandidate): string | undefined {
  if (place.kind.sumlevel === COUNTY_SUMLEVEL) return place.geoid; // 5-digit county FIPS
  if (place.kind.sumlevel === STATE_SUMLEVEL) return `${place.geoid}000`; // SS000 statewide
  return undefined;
}

/** The ownership vocabulary (ADR-013 §2): total covered is the default. */
const OWNERSHIP_VOCABULARY = [
  { code: "0", label: "total covered (all ownerships)" },
  { code: "5", label: "private" },
  { code: "1", label: "federal government" },
  { code: "2", label: "state government" },
  { code: "3", label: "local government" },
] as const;

/**
 * The NAICS industry vocabulary (ADR-013 §2): the QCEW supersectors/sectors, all-industries is the
 * default. QCEW's industry_code column uses the literal strings "31-33", "44-45" and "48-49" for
 * the sectors that span multiple 2-digit NAICS codes — verified against the recorded fixture and
 * the live API (see qcew.ts's agglvl comment for the verification commands).
 */
const INDUSTRY_VOCABULARY = [
  { code: "10", label: "all industries" },
  { code: "11", label: "agriculture, forestry, fishing and hunting" },
  { code: "21", label: "mining, quarrying, and oil and gas extraction" },
  { code: "22", label: "utilities" },
  { code: "23", label: "construction" },
  { code: "31-33", label: "manufacturing" },
  { code: "42", label: "wholesale trade" },
  { code: "44-45", label: "retail trade" },
  { code: "48-49", label: "transportation and warehousing" },
  { code: "51", label: "information" },
  { code: "52", label: "finance and insurance" },
  { code: "53", label: "real estate and rental and leasing" },
  { code: "54", label: "professional, scientific, and technical services" },
  { code: "55", label: "management of companies and enterprises" },
  { code: "56", label: "administrative and support and waste management services" },
  { code: "61", label: "educational services" },
  { code: "62", label: "health care and social assistance" },
  { code: "71", label: "arts, entertainment, and recreation" },
  { code: "72", label: "accommodation and food services" },
  { code: "81", label: "other services (except public administration)" },
  { code: "92", label: "public administration" },
] as const;

const OWNERSHIP_DIMENSION: DimensionDefinition = {
  argument: "ownership",
  description: "QCEW ownership sector.",
  vocabulary: OWNERSHIP_VOCABULARY,
  default: OWN_TOTAL_COVERED,
};

const INDUSTRY_DIMENSION: DimensionDefinition = {
  argument: "industry",
  description: "QCEW NAICS supersector/sector.",
  vocabulary: INDUSTRY_VOCABULARY,
  default: INDUSTRY_ALL,
};

/** Encode the area + resolved ownership/industry dimensions into the opaque series key. */
function buildQcewKey(area: string, ownCode: string, industryCode: string): string {
  return [area, ownCode, industryCode].join(KEY_SEPARATOR);
}

/** Decode a series key back into the area code and row selection. Undefined if malformed. */
function parseQcewKey(key: string): { area: string; selection: QcewRowSelection } | undefined {
  const [area, ownCode, industryCode] = key.split(KEY_SEPARATOR);
  if (!area || !ownCode || !industryCode) return undefined;
  return { area, selection: { ownCode, industryCode } };
}

type QcewMeasure = "employment" | "wage";

/** Fetch the latest published QCEW row for an area/selection, walking back a few quarters if needed. */
async function fetchLatestRow(
  client: HttpClient,
  area: string,
  selection: QcewRowSelection,
): Promise<QcewHeadline | undefined> {
  let q = latestPublishedQuarter(new Date());
  for (let i = 0; i < QCEW_MAX_LOOKBACK; i++) {
    const row = await fetchQcewRow(client, area, q, selection, {
      freshTtlSeconds: QCEW_CACHE_TTL_SECONDS,
    });
    if (row) return row;
    q = priorQuarter(q);
  }
  return undefined;
}

/** Turn a row into one observation for the requested measure (null value + footnote if suppressed). */
function toObservation(row: QcewHeadline, measure: QcewMeasure): SeriesObservation {
  const value = measure === "employment" ? row.employment : row.averageWeeklyWage;
  const disclosure = qcewDisclosureText(row.disclosureCode);
  return {
    year: String(row.year),
    period: `Q0${row.quarter}`,
    periodName: `Quarter ${row.quarter}`,
    value,
    footnotes: disclosure ? [{ code: row.disclosureCode, text: disclosure }] : [],
  };
}

/** A fetch capability for a QCEW measure: one opaque key (area|ownership|industry) → its latest-quarter observation. */
function qcewFetch(measure: QcewMeasure): IndicatorFetch {
  return async (client, keys): Promise<SeriesResult[]> => {
    const results: SeriesResult[] = [];
    for (const key of keys) {
      const parsed = parseQcewKey(key);
      const row = parsed ? await fetchLatestRow(client, parsed.area, parsed.selection) : undefined;
      results.push({
        seriesId: key,
        observations: row ? [toObservation(row, measure)] : [],
      });
    }
    return results;
  };
}

/** QCEW covered employment and average weekly wage (county + state), not seasonally adjusted. */
export const qcewIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "covered_employment",
    program: QCEW_PROGRAM,
    description: "QCEW covered employment (quarterly average of the monthly levels).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: qcewAreaCodeOf,
    buildSeriesId: (code, { dimensions }) =>
      buildQcewKey(code, dimensions.ownership ?? OWN_TOTAL_COVERED, dimensions.industry ?? INDUSTRY_ALL),
    dimensions: [INDUSTRY_DIMENSION, OWNERSHIP_DIMENSION],
    fetch: qcewFetch("employment"),
  },
  {
    name: "average_weekly_wage",
    program: QCEW_PROGRAM,
    description: "QCEW average weekly wage (dollars).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: qcewAreaCodeOf,
    buildSeriesId: (code, { dimensions }) =>
      buildQcewKey(code, dimensions.ownership ?? OWN_TOTAL_COVERED, dimensions.industry ?? INDUSTRY_ALL),
    dimensions: [INDUSTRY_DIMENSION, OWNERSHIP_DIMENSION],
    fetch: qcewFetch("wage"),
  },
];

import type { HttpClient, PlaceCandidate } from "@federal-mcps/core";
import { QCEW_ENDPOINT } from "./describe-source.js";
import {
  INDUSTRY_ALL,
  latestPublishedQuarter,
  OWN_TOTAL_COVERED,
  priorQuarter,
  type QcewHeadline,
  type QcewRowSelection,
  EARLIEST_QCEW_YEAR,
  fetchQcewCsv,
  parseQcewRow,
  qcewAnnualUrl,
  qcewAreaUrl,
  qcewDisclosureText,
} from "./qcew.js";
import type { DimensionDefinition, IndicatorDefinition } from "@federal-mcps/core";
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
 * likewise returns no observation rather than a guess. Metros resolve through the catalog's QCEW
 * `C`-code (#153).
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

const CBSA_SUMLEVEL = "310";

/**
 * The QCEW area code for a place: county = 5-digit FIPS, state = SS000 (both GEOID-derived), metro
 * = the `C`-code the catalog stores on the CBSA from QCEW's own area file (#153, ADR-013 §5).
 * Undefined otherwise — never a fabricated area.
 */
export function qcewAreaCodeOf(place: PlaceCandidate): string | undefined {
  if (place.kind.sumlevel === COUNTY_SUMLEVEL) return place.geoid; // 5-digit county FIPS
  if (place.kind.sumlevel === STATE_SUMLEVEL) return `${place.geoid}000`; // SS000 statewide
  if (place.kind.sumlevel === CBSA_SUMLEVEL) {
    return place.agencyCodes.find((c) => c.agency === "bls" && c.program === QCEW_PROGRAM)?.code;
  }
  return undefined;
}

/**
 * QCEW publishes NAICS sector detail only by ownership (there is no total-ownership row at the
 * sector aggregation level — verified on Denver County, Colorado and the Denver MSA). Rather than
 * return an empty answer, a sector request with the default total ownership is rejected with the
 * codes that do publish it (ADR-013 §1: never a silent default).
 */
function assertSectorHasOwnership(industryCode: string, ownCode: string): void {
  if (industryCode !== INDUSTRY_ALL && ownCode === OWN_TOTAL_COVERED) {
    throw new Error(
      `QCEW publishes sector detail (industry ${industryCode}) only by ownership, not as a total: pass ownership 5 (private), 1 (federal), 2 (state) or 3 (local government).`,
    );
  }
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
  description:
    "QCEW NAICS industry: a supersector/sector from the list, or any 3- to 6-digit NAICS code (e.g. 236 construction of buildings). Detail below the sector is often suppressed for small areas.",
  vocabulary: INDUSTRY_VOCABULARY,
  default: INDUSTRY_ALL,
  // #213: the files carry every NAICS level; a code the area does not publish returns a note.
  acceptsCode: (code) => /^\d{3,6}$/.test(code),
  openCodes: "any 3- to 6-digit NAICS code (e.g. 236, 2361, 236118)",
};

/** Quarterly slices (default) or annual averages (#213, ADR-017 §4). */
const FREQUENCY_DIMENSION: DimensionDefinition = {
  argument: "frequency",
  description:
    "quarterly (default) or annual averages. With startYear/endYear, QCEW returns every published period in the range, at most 5 years of quarters per call.",
  vocabulary: [
    { code: "quarterly", label: "quarterly" },
    { code: "annual", label: "annual averages" },
  ],
  default: "quarterly",
};

/** The key suffix marking annual averages; quarterly keys keep their pre-#213 form. */
const ANNUAL_SUFFIX = "a";

/** Encode the area + resolved ownership/industry dimensions into the opaque series key. */
function buildQcewKey(
  area: string,
  ownCode: string,
  industryCode: string,
  frequency = "quarterly",
): string {
  assertSectorHasOwnership(industryCode, ownCode);
  const parts = [area, ownCode, industryCode];
  if (frequency === "annual") parts.push(ANNUAL_SUFFIX);
  return parts.join(KEY_SEPARATOR);
}

/** Decode a series key back into the area code and row selection. Undefined if malformed. */
function parseQcewKey(
  key: string,
): { area: string; selection: QcewRowSelection; annual: boolean } | undefined {
  const [area, ownCode, industryCode, frequency] = key.split(KEY_SEPARATOR);
  if (!area || !ownCode || !industryCode) return undefined;
  return { area, selection: { ownCode, industryCode }, annual: frequency === ANNUAL_SUFFIX };
}

type QcewMeasure = "employment" | "wage";

/** At most this many periods per call (ADR-017 §4: 5 years of quarters). */
const QCEW_MAX_PERIODS = 20;

type Period = { year: number; quarter: number } | { year: number; annual: true };

const periodUrl = (area: string, p: Period): string =>
  "annual" in p ? qcewAnnualUrl(area, p.year) : qcewAreaUrl(area, p);

const periodName = (p: Period): string =>
  "annual" in p ? `${p.year} annual` : `${p.year} Q${p.quarter}`;

/**
 * The periods to read, newest first. Without explicit years: the latest few candidates (the first
 * published one wins). With years: every period in the range up to the latest that could be
 * published, floored at 2014 (where the open data begin), with notes for the floor.
 */
function candidatePeriods(
  annual: boolean,
  options: { startYear?: number; endYear?: number; explicitYears?: boolean },
  notes: string[],
): Period[] {
  const latestQ = latestPublishedQuarter(new Date());
  if (!options.explicitYears) {
    const out: Period[] = [];
    if (annual) {
      for (let y = latestQ.year; y > latestQ.year - QCEW_MAX_LOOKBACK; y--)
        out.push({ year: y, annual: true });
    } else {
      let q: { year: number; quarter: number } = latestQ;
      for (let i = 0; i < QCEW_MAX_LOOKBACK; i++) {
        out.push(q);
        q = priorQuarter(q);
      }
    }
    return out;
  }
  let startYear = options.startYear ?? options.endYear ?? latestQ.year;
  const endYear = Math.min(options.endYear ?? latestQ.year, latestQ.year);
  if (startYear < EARLIEST_QCEW_YEAR) {
    notes.push(
      `QCEW open data begin in ${EARLIEST_QCEW_YEAR}; the range was started there instead of ${startYear}.`,
    );
    startYear = EARLIEST_QCEW_YEAR;
  }
  const out: Period[] = [];
  if (annual) {
    for (let y = endYear; y >= startYear; y--) out.push({ year: y, annual: true });
  } else {
    let q: { year: number; quarter: number } =
      endYear < latestQ.year ? { year: endYear, quarter: 4 } : latestQ;
    while (q.year >= startYear) {
      out.push(q);
      q = priorQuarter(q);
    }
  }
  return out;
}

/**
 * Read the rows for one key across its periods, newest first: skips unpublished periods, stops at
 * QCEW_MAX_PERIODS published ones (noting the cap), and in latest-only mode stops at the first.
 */
async function fetchRows(
  client: HttpClient,
  area: string,
  selection: QcewRowSelection,
  periods: readonly Period[],
  latestOnly: boolean,
  notes: string[],
): Promise<{ rows: QcewHeadline[]; anyPublished: boolean }> {
  const want = latestOnly ? 1 : QCEW_MAX_PERIODS;
  // Fetch in parallel, a little beyond the cap so unpublished leading periods do not starve it.
  const window = periods.slice(0, want + QCEW_MAX_LOOKBACK);
  const csvs = await Promise.all(
    window.map((p) =>
      fetchQcewCsv(client, periodUrl(area, p), { freshTtlSeconds: QCEW_CACHE_TTL_SECONDS }),
    ),
  );
  const rows: QcewHeadline[] = [];
  let anyPublished = false;
  let consumed = 0;
  for (const csv of csvs) {
    consumed++;
    if (!csv) continue;
    anyPublished = true;
    const row = parseQcewRow(csv, selection);
    if (row) rows.push(row);
    if (rows.length >= want) break;
  }
  if (!latestOnly && rows.length >= want && periods.length > consumed) {
    const newest = rows[0];
    const oldest = rows.at(-1);
    notes.push(
      `QCEW history is served at most 5 years (${QCEW_MAX_PERIODS} quarters) per call; returned ${newest ? periodLabel(newest) : ""} back to ${oldest ? periodLabel(oldest) : ""}. Ask for an earlier range separately.`,
    );
  }
  return { rows, anyPublished };
}

const periodLabel = (r: QcewHeadline): string =>
  r.annual
    ? periodName({ year: r.year, annual: true })
    : periodName({ year: r.year, quarter: r.quarter });

/** Turn a row into one observation for the requested measure (null value + footnote if suppressed). */
function toObservation(row: QcewHeadline, measure: QcewMeasure): SeriesObservation {
  const value = measure === "employment" ? row.employment : row.averageWeeklyWage;
  const disclosure = qcewDisclosureText(row.disclosureCode);
  return {
    year: String(row.year),
    period: row.annual ? "A01" : `Q0${row.quarter}`,
    periodName: row.annual ? "Annual" : `Quarter ${row.quarter}`,
    value,
    footnotes: disclosure ? [{ code: row.disclosureCode, text: disclosure }] : [],
  };
}

/**
 * A fetch capability for a QCEW measure (#213): one opaque key (area|ownership|industry[|a]) → its
 * latest published period, or — when the caller gave years — every published period in range,
 * newest first. A code the area does not publish yields no observation and a note, never a guess.
 */
function qcewFetch(measure: QcewMeasure): IndicatorFetch {
  return async (client, keys, options): Promise<SeriesResult[]> =>
    Promise.all(
      keys.map(async (key): Promise<SeriesResult> => {
        const parsed = parseQcewKey(key);
        if (!parsed) return { seriesId: key, observations: [] };
        const notes: string[] = [];
        const latestOnly = !options.explicitYears;
        const periods = candidatePeriods(parsed.annual, options, notes);
        const { rows, anyPublished } = await fetchRows(
          client,
          parsed.area,
          parsed.selection,
          periods,
          latestOnly,
          notes,
        );
        if (rows.length === 0 && anyPublished && parsed.selection.industryCode !== INDUSTRY_ALL) {
          notes.push(
            `NAICS ${parsed.selection.industryCode} is not published for area ${parsed.area} in the period asked (the industry may not exist there, or QCEW does not publish that ownership/industry pair).`,
          );
        }
        return {
          seriesId: key,
          observations: rows.map((r) => toObservation(r, measure)),
          ...(notes.length > 0 ? { notes } : {}),
        };
      }),
    );
}

/** Where the QCEW open data slices live; a comparison across areas cites this (#212). */
const QCEW_DATA_HOME = `${QCEW_ENDPOINT}/`;

/**
 * The source a QCEW answer actually read (#212): the area's CSV slice for the quarter returned
 * (the timeseries API is not involved), and the selection in words for the citation instead of
 * the opaque `area|ownership|industry` key.
 */
function qcewSourceOf(
  key: string,
  latest: SeriesObservation | undefined,
): { url: string; label: string } | undefined {
  const parsed = parseQcewKey(key);
  if (!parsed) return undefined;
  const { area, selection } = parsed;
  const own =
    OWNERSHIP_VOCABULARY.find((v) => v.code === selection.ownCode)?.label ??
    `ownership ${selection.ownCode}`;
  const industry =
    selection.industryCode === INDUSTRY_ALL
      ? "all industries"
      : `NAICS ${selection.industryCode} (${INDUSTRY_VOCABULARY.find((v) => v.code === selection.industryCode)?.label ?? "industry"})`;
  const label = `area ${area}, ${own}, ${industry}, ${parsed.annual ? "annual averages" : "quarterly"}`;
  const quarter = latest ? /^Q0?(\d)$/.exec(latest.period)?.[1] : undefined;
  const url = !latest
    ? QCEW_DATA_HOME
    : parsed.annual || latest.period === "A01"
      ? qcewAnnualUrl(area, Number(latest.year))
      : quarter
        ? qcewAreaUrl(area, { year: Number(latest.year), quarter: Number(quarter) })
        : QCEW_DATA_HOME;
  return { url, label };
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
      buildQcewKey(
        code,
        dimensions.ownership ?? OWN_TOTAL_COVERED,
        dimensions.industry ?? INDUSTRY_ALL,
        dimensions.frequency,
      ),
    dimensions: [INDUSTRY_DIMENSION, OWNERSHIP_DIMENSION, FREQUENCY_DIMENSION],
    fetch: qcewFetch("employment"),
    // #213: history when years are asked for (latest period otherwise); cites the file read (#212).
    sourceOf: qcewSourceOf,
    sourceHome: QCEW_DATA_HOME,
  },
  {
    name: "average_weekly_wage",
    program: QCEW_PROGRAM,
    description: "QCEW average weekly wage (dollars).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: qcewAreaCodeOf,
    buildSeriesId: (code, { dimensions }) =>
      buildQcewKey(
        code,
        dimensions.ownership ?? OWN_TOTAL_COVERED,
        dimensions.industry ?? INDUSTRY_ALL,
        dimensions.frequency,
      ),
    dimensions: [INDUSTRY_DIMENSION, OWNERSHIP_DIMENSION, FREQUENCY_DIMENSION],
    fetch: qcewFetch("wage"),
    // #213: history when years are asked for (latest period otherwise); cites the file read (#212).
    sourceOf: qcewSourceOf,
    sourceHome: QCEW_DATA_HOME,
  },
];

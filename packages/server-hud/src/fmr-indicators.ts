import {
  type DimensionDefinition,
  getContainment,
  type GeographyCatalog,
  type HttpClient,
  type IndicatorDefinition,
  type IndicatorFallback,
  type IndicatorFetch,
  type PlaceCandidate,
  type SeriesObservation,
  type SeriesResult,
} from "@federal-mcps/core";
import { fmrEntityOf, fmrUrl, hudGetJson } from "./hud-api.js";

/**
 * Fair Market Rents and Small Area FMRs (#233, ADR-018 §3). One indicator, `fair_market_rent`,
 * over the FMR program: `hud-api.ts` already builds the county entity id and the URL; this file
 * owns the `bedrooms` dimension, the county → city fallback (HUD sets FMRs per FMR area, not by
 * city — the county's area is the answer), the fiscal-year fetch (latest, or one call per year
 * in an explicit range), and Cook County's Small Area FMR shape (`basicdata` becomes a list of
 * ZIP rows; a county answer reads the "MSA level" row).
 */
const FMR_PROGRAM = "FMR";
const COUNTY_SUMLEVEL = "050";
const PLACE_SUMLEVEL = "160";

/** HUD's earliest published FMR fiscal year (docs/spikes/m11-hud-user-server.md); FY2016 answers 400. */
const FMR_FLOOR_FISCAL_YEAR = 2017;

/** Separates the entity id from the bedroom code in the opaque series key. */
const KEY_SEPARATOR = "|";

/** The `bedrooms` vocabulary (ADR-018 §3): the `basicdata` key each code reads. */
const BEDROOMS_BASICDATA_KEY: Record<string, string> = {
  "0": "Efficiency",
  "1": "One-Bedroom",
  "2": "Two-Bedroom",
  "3": "Three-Bedroom",
  "4": "Four-Bedroom",
};

const BEDROOMS_VOCABULARY = [
  { code: "0", label: "efficiency" },
  { code: "1", label: "one-bedroom" },
  { code: "2", label: "two-bedroom" },
  { code: "3", label: "three-bedroom" },
  { code: "4", label: "four-bedroom" },
] as const;

const BEDROOMS_DIMENSION: DimensionDefinition = {
  argument: "bedrooms",
  description: "Unit size: 0 (efficiency) through 4 (four-bedroom).",
  vocabulary: BEDROOMS_VOCABULARY,
  default: "2",
};

/** The FMR/IL entity id for a place, direct for a county; undefined elsewhere (`hud-api.ts`). */
function fmrAgencyCodeOf(place: PlaceCandidate): string | undefined {
  return fmrEntityOf(place);
}

/**
 * A city falls back to its containing county's FMR area (ADR-018 §3): HUD sets Fair Market
 * Rents per FMR area, never by city, so the county's rate is the answer with a caveat naming
 * it. A New England county (fmrEntityOf reuses `hud-api.ts`'s town rule) yields no fallback —
 * towns need county-subdivision ids the catalog does not hold yet (#241).
 */
function fmrFallback(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
): IndicatorFallback | undefined {
  if (place.kind.sumlevel !== PLACE_SUMLEVEL) return undefined;
  const counties = getContainment(catalog, place.ucgid)
    .filter((e) => e.kind.sumlevel === COUNTY_SUMLEVEL)
    .sort((a, b) => b.share - a.share);
  const county = counties[0];
  if (!county) return undefined;
  const code = fmrEntityOf({
    geoid: county.geoid,
    kind: { sumlevel: COUNTY_SUMLEVEL, label: county.kind.label },
  } as unknown as PlaceCandidate);
  if (!code) return undefined;
  return {
    geoid: county.geoid,
    name: county.name,
    sumlevel: COUNTY_SUMLEVEL,
    code,
    caveat: `HUD sets Fair Market Rents per FMR area, not by city: this is ${county.name}'s area rate, covering ${place.name}.`,
  };
}

/** Encode the entity id and the resolved bedroom code into the opaque series key. */
function buildFmrKey(entity: string, bedrooms: string): string {
  return [entity, bedrooms].join(KEY_SEPARATOR);
}

function parseFmrKey(key: string): { entity: string; bedrooms: string } | undefined {
  const [entity, bedrooms] = key.split(KEY_SEPARATOR);
  if (!entity || !bedrooms) return undefined;
  return { entity, bedrooms };
}

interface FmrRow {
  zip_code?: string;
  [bedroomKey: string]: unknown;
}

interface FmrResponseData {
  area_name: string;
  smallarea_status?: string;
  /** Present at the top level for the Small Area FMR list shape (Cook County, verified live). */
  year?: string;
  basicdata: Record<string, unknown> | FmrRow[];
}

interface FmrResponse {
  data: FmrResponseData;
}

/**
 * The fiscal years to request, newest first: a single "no year" call (HUD's latest, ADR-018 §3)
 * when the caller gave no explicit range, else one call per year in the range, floored at
 * FY2017. "Never beyond the latest" is enforced by HUD itself: a fiscal year not yet published
 * answers 400/404, which `hudGetJson` turns into no observation (never a guess), the same as the
 * floor.
 */
function fiscalYearsToFetch(
  options: { startYear?: number; endYear?: number; explicitYears?: boolean },
  notes: string[],
): (number | undefined)[] {
  if (!options.explicitYears) return [undefined];
  const endYear = options.endYear ?? options.startYear;
  let startYear = options.startYear ?? endYear;
  if (startYear === undefined || endYear === undefined) return [undefined];
  if (startYear < FMR_FLOOR_FISCAL_YEAR) {
    notes.push(
      `HUD Fair Market Rent data begins at FY${FMR_FLOOR_FISCAL_YEAR}; the range was started there instead of FY${startYear}.`,
    );
    startYear = FMR_FLOOR_FISCAL_YEAR;
  }
  const years: number[] = [];
  for (let y = endYear; y >= startYear; y--) years.push(y);
  return years;
}

/** True when HUD answered the Small Area FMR shape: `basicdata` is a list of ZIP rows. */
function isSmallAreaRows(basicdata: FmrResponseData["basicdata"]): basicdata is FmrRow[] {
  return Array.isArray(basicdata);
}

/**
 * One observation from an FMR response for the requested bedroom code, plus any notes it earns
 * (the effective date of the fiscal year, and — for a Small Area FMR county — that ZIP-level
 * rates exist and this answer uses the county-wide "MSA level" row). Never a fabricated value:
 * a response missing the row or the bedroom key yields a null value.
 */
function observationFrom(
  body: FmrResponse,
  requestedYear: number | undefined,
  bedrooms: string,
  notes: string[],
): SeriesObservation {
  const data = body.data;
  const basicdataKey = BEDROOMS_BASICDATA_KEY[bedrooms];
  let fiscalYear: string;
  let value: number | null = null;
  if (isSmallAreaRows(data.basicdata)) {
    const msaRow = data.basicdata.find((r) => r.zip_code === "MSA level");
    const raw = basicdataKey && msaRow ? msaRow[basicdataKey] : undefined;
    value = typeof raw === "number" ? raw : null;
    fiscalYear = requestedYear !== undefined ? String(requestedYear) : (data.year ?? "");
    const zipRows = data.basicdata.length - (msaRow ? 1 : 0);
    notes.push(
      `Small Area FMRs by ZIP apply in ${data.area_name} (${zipRows} ZIP codes); this answer uses the county-wide "MSA level" rate.`,
    );
  } else {
    const raw = basicdataKey ? data.basicdata[basicdataKey] : undefined;
    value = typeof raw === "number" ? raw : null;
    // biome-ignore lint/complexity/useLiteralKeys: tsc's noPropertyAccessFromIndexSignature requires brackets here
    const basicdataYear = data.basicdata["year"];
    fiscalYear =
      requestedYear !== undefined
        ? String(requestedYear)
        : typeof basicdataYear === "string"
          ? basicdataYear
          : String(basicdataYear ?? "");
  }
  if (fiscalYear) {
    const effective = Number(fiscalYear) - 1;
    notes.push(`${data.area_name}: FY${fiscalYear} takes effect October 1, ${effective}.`);
  }
  return {
    year: fiscalYear,
    period: "A01",
    periodName: `FY${fiscalYear}`,
    value,
    footnotes: [],
  };
}

/**
 * The FMR fetch capability (#233): one call per requested fiscal year (or a single "latest"
 * call), newest first. HUD's 400/404 for an unpublished year (too old, or not yet published)
 * becomes no observation for that year plus a note — never a number invented to fill the gap.
 */
const fmrFetch: IndicatorFetch = async (
  client: HttpClient,
  keys,
  options,
): Promise<SeriesResult[]> =>
  Promise.all(
    keys.map(async (key): Promise<SeriesResult> => {
      const parsed = parseFmrKey(key);
      if (!parsed) return { seriesId: key, observations: [] };
      const notes: string[] = [];
      const years = fiscalYearsToFetch(options, notes);
      const observations: SeriesObservation[] = [];
      for (const year of years) {
        const url = fmrUrl(parsed.entity, year);
        const body = await hudGetJson<FmrResponse>(client, url, () => options.apiKey);
        if (!body) {
          notes.push(
            year === undefined
              ? `HUD has no current Fair Market Rent data for ${parsed.entity}.`
              : `HUD does not publish FY${year} Fair Market Rent data for ${parsed.entity}.`,
          );
          continue;
        }
        observations.push(observationFrom(body, year, parsed.bedrooms, notes));
      }
      return { seriesId: key, observations, ...(notes.length > 0 ? { notes } : {}) };
    }),
  );

/** Where an FMR answer actually read (#212): the entity id and bedroom size in words. */
function fmrSourceOf(
  key: string,
  latest: SeriesObservation | undefined,
): { url: string; label: string } | undefined {
  const parsed = parseFmrKey(key);
  if (!parsed) return undefined;
  const bedroomLabel =
    BEDROOMS_VOCABULARY.find((v) => v.code === parsed.bedrooms)?.label ??
    `bedrooms ${parsed.bedrooms}`;
  const year = latest ? Number(latest.year) : undefined;
  const url = fmrUrl(parsed.entity, year);
  return { url, label: `Fair Market Rent, entity ${parsed.entity}, ${bedroomLabel}` };
}

/** Fair Market Rents (ADR-018 §3): one indicator, `bedrooms` 0–4 (default two-bedroom). */
export const fmrIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "fair_market_rent",
    program: FMR_PROGRAM,
    description:
      "HUD Fair Market Rent by bedroom count, published per FMR area (a county outside New England). A city answers with its county's area rate.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: fmrAgencyCodeOf,
    buildSeriesId: (code, { dimensions }) => buildFmrKey(code, dimensions.bedrooms ?? "2"),
    dimensions: [BEDROOMS_DIMENSION],
    fallback: fmrFallback,
    fetch: fmrFetch,
    sourceOf: fmrSourceOf,
  },
];

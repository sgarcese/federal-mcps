import type {
  DimensionDefinition,
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
import { fmrEntityOf, hudGetJson, ilUrl, mtspUrl } from "./hud-api.js";
import { hudAreaFallback, newEnglandCountyNote } from "./towns.js";

/**
 * Income Limits, area median income and MTSP limits (#234, ADR-018 §3). Income Limits and MTSP
 * limits share the same county entity id as FMR (`fmrEntityOf`, #232) and the same HUD fiscal-year
 * rules: a call without `year` returns HUD's latest, an explicit range asks one call per fiscal
 * year (newest first, floored at FY2017 — earlier answers HUD 400, so it is never attempted), and a
 * 400/404 becomes "no observation" rather than a guess (`hud-api.ts`'s `hudGetJson`). A city has no
 * income-limit-area id of its own; HUD publishes by county, so a city falls back to its containing
 * county with a caveat naming the substitution — the same shape as LAUS's below-threshold fallback.
 *
 * A resolved series key packs the entity id and the (already-defaulted) dimension codes so the
 * fetch capability, given only the opaque key, can rebuild the exact URL and pick the right value:
 * `income_limit`/`mtsp_limit` use `${entity}|${level}|${householdSize}`; `area_median_income`
 * ignores dimensions and uses the bare entity id.
 */

const _CITY_SUMLEVEL = "160";
const _COUNTY_SUMLEVEL = "050";
const KEY_SEPARATOR = "|";
/** HUD's Income Limits and MTSP open data begin at this fiscal year (docs/spikes/m11-hud-user-server.md). */
const FLOOR_FISCAL_YEAR = 2017;

const HOUSEHOLD_SIZE_VOCABULARY = Array.from({ length: 8 }, (_, i) => ({
  code: String(i + 1),
  label: `${i + 1}-person household`,
}));

const HOUSEHOLD_SIZE_DIMENSION: DimensionDefinition = {
  argument: "household_size",
  description: "Household size, 1 to 8 people (default 4).",
  vocabulary: HOUSEHOLD_SIZE_VOCABULARY,
  default: "4",
};

/** A level band this server can pick out of a HUD Income Limits/MTSP response. */
interface LevelEntry {
  code: string;
  label: string;
  /** The top-level object in `data` holding this band's per-size figures. */
  block: string;
  /** The per-size field prefix inside that block, e.g. `il80` for `il80_p4`. */
  prefix: string;
}

/** Income Limits bands (verified against the recorded fixture, #234). */
const IL_LEVELS: readonly LevelEntry[] = [
  {
    code: "30",
    label: "extremely low income (30% of area median income)",
    block: "extremely_low",
    prefix: "il30",
  },
  {
    code: "50",
    label: "very low income (50% of area median income)",
    block: "very_low",
    prefix: "il50",
  },
  { code: "80", label: "low income (80% of area median income)", block: "low", prefix: "il80" },
];

/**
 * MTSP bands, derived from the recorded fixture's own keys (`6cf7709…json`), not from memory: the
 * six percent-of-AMI bands HUD's MTSP endpoint always carries, plus the two HERA special limits
 * (50% and 60%) some areas additionally publish — a state's high-cost designation, not every place.
 */
const MTSP_LEVELS: readonly LevelEntry[] = [
  { code: "20", label: "20% of area median income", block: "20percent", prefix: "il20" },
  { code: "30", label: "30% of area median income", block: "30percent", prefix: "il30" },
  { code: "40", label: "40% of area median income", block: "40percent", prefix: "il40" },
  { code: "50", label: "50% of area median income", block: "50percent", prefix: "il50" },
  { code: "60", label: "60% of area median income", block: "60percent", prefix: "il60" },
  { code: "70", label: "70% of area median income", block: "70percent", prefix: "il70" },
  { code: "80", label: "80% of area median income", block: "80percent", prefix: "il80" },
  {
    code: "hera_special_50",
    label: "50% of area median income (HERA special limits)",
    block: "hera_special_50percent",
    prefix: "hera_special_il50",
  },
  {
    code: "hera_special_60",
    label: "60% of area median income (HERA special limits)",
    block: "hera_special_60percent",
    prefix: "hera_special_il60",
  },
];

const IL_LEVEL_DIMENSION: DimensionDefinition = {
  argument: "level",
  description:
    "Income Limit level: 30% (extremely low), 50% (very low) or 80% (low) of area median income. Default 80%.",
  vocabulary: IL_LEVELS.map((l) => ({ code: l.code, label: l.label })),
  default: "80",
};

const MTSP_LEVEL_DIMENSION: DimensionDefinition = {
  argument: "level",
  description:
    "MTSP limit band, as a percent of area median income; some states additionally publish HERA special 50%/60% bands. Default 60%.",
  vocabulary: MTSP_LEVELS.map((l) => ({ code: l.code, label: l.label })),
  default: "60",
};

/** county → SSCCC99999 (the same entity FMR and MTSP use); undefined for places HUD has none for. */
function ilAgencyCodeOf(place: PlaceCandidate): string | undefined {
  return fmrEntityOf(place);
}

/**
 * HUD sets Income Limits and MTSP limits per income-limit area — a county or metro area, a town in
 * New England — not by city (#241): a city answers with its area, with a caveat naming the
 * substitution, never silently (mirrors LAUS's below-threshold county fallback, ADR-009 §6).
 */
function ilCountyFallback(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
): IndicatorFallback | undefined {
  return hudAreaFallback(
    catalog,
    place,
    "Income Limits and MTSP limits",
    (county, name) =>
      `Covers ${county}, not just ${name}: HUD publishes Income Limits and MTSP limits per income-limit area (county), not by city.`,
  );
}

/**
 * Connecticut towns were recoded with the 2022 planning regions (#241): the URL builders send HUD
 * the new id from FY2025 and the 2020 id before, so a history spans both — said, not hidden.
 */
function connecticutPlanningRegionCaveat(place: PlaceCandidate): string | undefined {
  return place.geoid.slice(0, 2) === "09" && place.kind.sumlevel === "060"
    ? "Connecticut: HUD lists this town under its planning-region id from FY2025 and its former county id before; the area name can differ between those years."
    : undefined;
}

/** Encode entity + resolved level/household_size into the opaque series key. */
function buildLevelSizeKey(
  entity: string,
  dimensions: { level?: string; household_size?: string },
): string {
  return [entity, dimensions.level ?? "", dimensions.household_size ?? ""].join(KEY_SEPARATOR);
}

function parseLevelSizeKey(
  key: string,
): { entity: string; level: string; size: string } | undefined {
  const [entity, level, size] = key.split(KEY_SEPARATOR);
  if (!entity || !level || !size) return undefined;
  return { entity, level, size };
}

/** Pull one band's per-size figure out of a parsed HUD response, or undefined if absent. */
function pickLevelValue(
  data: Record<string, unknown>,
  level: LevelEntry,
  size: string,
): number | undefined {
  const block = data[level.block];
  if (typeof block !== "object" || block === null) return undefined;
  const value = (block as Record<string, unknown>)[`${level.prefix}_p${size}`];
  return typeof value === "number" ? value : undefined;
}

/**
 * The fiscal years to read, newest first. Without an explicit range: a single `undefined` "give me
 * whatever HUD calls latest" slot. With one: every fiscal year from `endYear` down to `startYear`,
 * floored at FY2017 (earlier predates HUD's open data and answers 400) — with a note when the floor
 * bites, or when the whole requested range predates it (nothing to fetch).
 */
function fiscalYearsToFetch(options: SeriesFetchOptions): {
  years: readonly (number | undefined)[];
  notes: string[];
} {
  if (!options.explicitYears) return { years: [undefined], notes: [] };
  const notes: string[] = [];
  const endYear = options.endYear ?? options.startYear;
  let startYear = options.startYear ?? endYear;
  if (endYear === undefined || startYear === undefined) return { years: [undefined], notes };
  if (endYear < FLOOR_FISCAL_YEAR) {
    notes.push(
      `HUD Income Limits and MTSP limits begin at fiscal year ${FLOOR_FISCAL_YEAR}; none of the requested FY${startYear}–${endYear} range is published.`,
    );
    return { years: [], notes };
  }
  if (startYear < FLOOR_FISCAL_YEAR) {
    notes.push(
      `HUD Income Limits and MTSP limits begin at fiscal year ${FLOOR_FISCAL_YEAR}; the range was started there instead of FY${startYear}.`,
    );
    startYear = FLOOR_FISCAL_YEAR;
  }
  const years: number[] = [];
  for (let y = endYear; y >= startYear; y--) years.push(y);
  return { years, notes };
}

type IlBody = { data?: Record<string, unknown> } | undefined;

/**
 * One entity's fiscal-year responses for `years` (as `fiscalYearsToFetch` returns them). Without an
 * explicit range, `years` is the single `[undefined]` sentinel and this makes one unqualified call
 * ("latest"). With a range, it first makes ONE unqualified call to learn the fiscal year HUD
 * actually calls latest (from the response's own `year` field) — the same "latest" a caller who
 * omits years gets — and reuses that response for whichever requested year matches it; every other
 * requested year gets its own qualified `?year=` call. This means a range whose newest year is
 * HUD's current one (the common case: the tool defaults an omitted `endYear` to the current
 * calendar year) never needs an explicit-year call HUD wasn't asked to publish yet.
 */
async function fetchYears(
  client: HttpClient,
  urlOf: (entity: string, year?: number) => string,
  entity: string,
  apiKey: () => string | undefined,
  years: readonly (number | undefined)[],
): Promise<{ year: number | undefined; body: IlBody }[]> {
  if (years.length === 1 && years[0] === undefined) {
    return [
      {
        year: undefined,
        body: await hudGetJson<{ data?: Record<string, unknown> }>(client, urlOf(entity), apiKey),
      },
    ];
  }
  const explicitYears = years as readonly number[];
  const latestBody = await hudGetJson<{ data?: Record<string, unknown> }>(
    client,
    urlOf(entity),
    apiKey,
  );
  // biome-ignore lint/complexity/useLiteralKeys: tsc's noPropertyAccessFromIndexSignature requires brackets here
  const latestYearField = latestBody?.data?.["year"];
  const latestYear = typeof latestYearField === "string" ? Number(latestYearField) : undefined;
  const out: { year: number; body: IlBody }[] = [];
  for (const year of explicitYears) {
    if (year === latestYear) {
      out.push({ year, body: latestBody });
    } else {
      out.push({
        year,
        body: await hudGetJson<{ data?: Record<string, unknown> }>(
          client,
          urlOf(entity, year),
          apiKey,
        ),
      });
    }
  }
  return out;
}

/** Turn one entity's fetched fiscal-year bodies into observations + notes, given how to read a value. */
function observationsFrom(
  program: string,
  yearBodies: readonly { year: number | undefined; body: IlBody }[],
  readValue: (data: Record<string, unknown>) => number | null,
): { observations: SeriesObservation[]; notes: string[] } {
  const observations: SeriesObservation[] = [];
  const notes: string[] = [];
  let areaNamed = false;
  for (const { year, body } of yearBodies) {
    if (!body?.data) {
      notes.push(
        year === undefined
          ? `${program} has no published data for this entity.`
          : `${program} has no published data for fiscal year ${year} at this entity.`,
      );
      continue;
    }
    const data = body.data;
    if (!areaNamed) {
      // biome-ignore lint/complexity/useLiteralKeys: tsc's noPropertyAccessFromIndexSignature requires brackets here
      const areaName = data["area_name"];
      if (typeof areaName === "string" && areaName.length > 0) {
        notes.push(`Income-limit area: ${areaName}.`);
        areaNamed = true;
      }
    }
    // biome-ignore lint/complexity/useLiteralKeys: tsc's noPropertyAccessFromIndexSignature requires brackets here
    const yearField = data["year"];
    const fiscalYear = typeof yearField === "string" ? yearField : String(year);
    observations.push({
      year: fiscalYear,
      period: "A01",
      periodName: `FY${fiscalYear}`,
      value: readValue(data),
      footnotes: [],
    });
  }
  return { observations, notes };
}

/**
 * Fetch one entity+level+household_size series across its fiscal years (`income_limit`,
 * `mtsp_limit`). See `fetchYears` for how the newest year avoids needing a qualified call HUD
 * was never explicitly asked to publish.
 */
async function fetchLevelSeries(
  client: HttpClient,
  seriesIds: readonly string[],
  options: SeriesFetchOptions,
  urlOf: (entity: string, year?: number) => string,
  levels: readonly LevelEntry[],
  program: string,
): Promise<SeriesResult[]> {
  const { years, notes: rangeNotes } = fiscalYearsToFetch(options);
  const results: SeriesResult[] = [];
  for (const key of seriesIds) {
    const parsed = parseLevelSizeKey(key);
    if (!parsed) {
      results.push({ seriesId: key, observations: [], notes: [`malformed ${program} series key`] });
      continue;
    }
    const level = levels.find((l) => l.code === parsed.level);
    const yearBodies =
      years.length > 0
        ? await fetchYears(client, urlOf, parsed.entity, () => options.apiKey, years)
        : [];
    const { observations, notes } = observationsFrom(program, yearBodies, (data) =>
      level ? (pickLevelValue(data, level, parsed.size) ?? null) : null,
    );
    results.push({
      seriesId: key,
      observations,
      ...([...rangeNotes, ...notes].length > 0 ? { notes: [...rangeNotes, ...notes] } : {}),
    });
  }
  return results;
}

/** `area_median_income` has no dimensions: the key is the bare entity id. */
async function fetchMedianIncome(
  client: HttpClient,
  seriesIds: readonly string[],
  options: SeriesFetchOptions,
): Promise<SeriesResult[]> {
  const { years, notes: rangeNotes } = fiscalYearsToFetch(options);
  const results: SeriesResult[] = [];
  for (const entity of seriesIds) {
    const yearBodies =
      years.length > 0 ? await fetchYears(client, ilUrl, entity, () => options.apiKey, years) : [];
    const { observations, notes } = observationsFrom("IL", yearBodies, (data) => {
      // biome-ignore lint/complexity/useLiteralKeys: tsc's noPropertyAccessFromIndexSignature requires brackets here
      const median = data["median_income"];
      return typeof median === "number" ? median : null;
    });
    results.push({
      seriesId: entity,
      observations,
      ...([...rangeNotes, ...notes].length > 0 ? { notes: [...rangeNotes, ...notes] } : {}),
    });
  }
  return results;
}

const ilFetch: IndicatorFetch = (client, seriesIds, options) =>
  fetchLevelSeries(client, seriesIds, options, ilUrl, IL_LEVELS, "Income Limits");

const mtspFetch: IndicatorFetch = (client, seriesIds, options) =>
  fetchLevelSeries(client, seriesIds, options, mtspUrl, MTSP_LEVELS, "MTSP");

/** Rebuild the URL a series key's latest observation actually came from, for the citation (#212). */
function levelSourceOf(urlOf: (entity: string, year?: number) => string, label: string) {
  return (seriesKey: string, latest: SeriesObservation | undefined) => {
    const entity = seriesKey.split(KEY_SEPARATOR)[0] ?? seriesKey;
    const year = latest?.year ? Number(latest.year) : undefined;
    return {
      url: urlOf(entity, year),
      label: year ? `${label} (FY${year})` : label,
    };
  };
}

function ilCaveatOf(place: PlaceCandidate): string | undefined {
  return connecticutPlanningRegionCaveat(place);
}

/** Income Limits, area median income and MTSP limits (ADR-018 §3). */
export const ilIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "income_limit",
    program: "IL",
    description:
      "HUD Income Limits: the maximum household income by level (extremely low 30%, very low 50%, low 80% of area median income) and household size.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: ilAgencyCodeOf,
    fallback: ilCountyFallback,
    unavailableNote: (place) => newEnglandCountyNote(place, "Income Limits and MTSP limits"),
    caveatOf: ilCaveatOf,
    dimensions: [IL_LEVEL_DIMENSION, HOUSEHOLD_SIZE_DIMENSION],
    buildSeriesId: (code, { dimensions }) => buildLevelSizeKey(code, dimensions),
    fetch: ilFetch,
    sourceOf: levelSourceOf(ilUrl, "HUD Income Limits"),
  },
  {
    name: "area_median_income",
    program: "IL",
    description:
      "HUD's area median income (AMI) for the income-limit area, the basis for every Income Limit and MTSP band.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: ilAgencyCodeOf,
    fallback: ilCountyFallback,
    unavailableNote: (place) => newEnglandCountyNote(place, "Income Limits and MTSP limits"),
    caveatOf: ilCaveatOf,
    buildSeriesId: (code) => code,
    fetch: fetchMedianIncome,
    sourceOf: levelSourceOf(ilUrl, "HUD area median income"),
  },
  {
    name: "mtsp_limit",
    program: "MTSP",
    description:
      "HUD Multifamily Tax Subsidy Project (MTSP) income limits: the band, from 20% to 80% of area median income (plus HERA special 50%/60% limits where published), by household size.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: ilAgencyCodeOf,
    fallback: ilCountyFallback,
    unavailableNote: (place) => newEnglandCountyNote(place, "Income Limits and MTSP limits"),
    caveatOf: ilCaveatOf,
    dimensions: [MTSP_LEVEL_DIMENSION, HOUSEHOLD_SIZE_DIMENSION],
    buildSeriesId: (code, { dimensions }) => buildLevelSizeKey(code, dimensions),
    fetch: mtspFetch,
    sourceOf: levelSourceOf(mtspUrl, "HUD MTSP limits"),
  },
];

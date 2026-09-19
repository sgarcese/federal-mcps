import type { IndicatorFetch, SeriesObservation, SeriesResult } from "@federal-mcps/core";
import { CENSUS_API_ENDPOINT } from "./describe-source.js";

/**
 * The ACS fetch capability (ADR-014 §2–§4, #171): one variable for one place from the Census
 * Data API, with the product chosen by population, margins of error and reliability grades on
 * every value, and annotation sentinels as null plus their Census meaning — never a number.
 *
 * A "series key" here is `acs:<vintage>:<product>:<family>:<variable>:<ucgid>`; the definitions
 * build it and this module parses it (ADR-011 §2: keys are opaque to the tools).
 */

/** The latest published ACS vintage (verified 2026-09-18: 2025 is not out). */
export const ACS_VINTAGE = "2024";
/** ACS 1-year estimates exist only for areas of this population or more. */
export const ACS_ONE_YEAR_THRESHOLD = 65_000;
/** Query responses are immutable once a vintage is released; cache for 30 days. */
const ACS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Summary levels the 1-year product never covers (tract, block group, ZCTA). */
const FIVE_YEAR_ONLY = new Set(["140", "150", "860"]);

export type AcsProduct = "1-year" | "5-year";
/** Which ACS endpoint family a variable belongs to. */
export type AcsFamily = "detailed" | "subject" | "profile";

export interface AcsQuery {
  vintage: string;
  product: AcsProduct;
  family: AcsFamily;
  /** Variable id without its E/M suffix, e.g. `B19013_001`, `S1701_C03_001`, `DP04_0046P`. */
  variable: string;
  ucgid: string;
}

/** The dataset path for a product/family pair: `acs/acs1`, `acs/acs5/subject`, … */
export function acsDataset(product: AcsProduct, family: AcsFamily): string {
  const base = product === "1-year" ? "acs/acs1" : "acs/acs5";
  return family === "detailed" ? base : `${base}/${family}`;
}

/** The query URL (no key — that rides as `queryAuth`). Order matters: fixtures hash this string. */
export function buildAcsQueryUrl(q: AcsQuery): string {
  const v = q.variable;
  return `${CENSUS_API_ENDPOINT}/${q.vintage}/${acsDataset(q.product, q.family)}?get=NAME,${v}E,${v}M,${v}EA,${v}MA&ucgid=${q.ucgid}`;
}

export function buildAcsSeriesKey(q: AcsQuery): string {
  return `acs:${q.vintage}:${q.product}:${q.family}:${q.variable}:${q.ucgid}`;
}

export function parseAcsSeriesKey(key: string): AcsQuery | undefined {
  const [tag, vintage, product, family, variable, ucgid] = key.split(":");
  if (tag !== "acs" || !vintage || !product || !family || !variable || !ucgid) return undefined;
  if (product !== "1-year" && product !== "5-year") return undefined;
  if (family !== "detailed" && family !== "subject" && family !== "profile") return undefined;
  return { vintage, product, family, variable, ucgid };
}

/** Which product a place gets, and why (ADR-014 §2). */
export function chooseProduct(input: {
  population: number | null;
  sumlevel: string;
  requested?: AcsProduct | undefined;
}): { product: AcsProduct; reason: string } {
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (FIVE_YEAR_ONLY.has(input.sumlevel)) {
    return {
      product: "5-year",
      reason: "tracts and ZCTAs are published only in the ACS 5-year product",
    };
  }
  const eligible = input.population !== null && input.population >= ACS_ONE_YEAR_THRESHOLD;
  if (input.requested === "5-year") {
    return { product: "5-year", reason: "the 5-year product was requested" };
  }
  if (input.requested === "1-year" && !eligible) {
    return {
      product: "5-year",
      reason:
        input.population === null
          ? `the 1-year product was requested, but this area's population is unknown to the catalog and the ACS publishes 1-year estimates only at or above ${fmt(ACS_ONE_YEAR_THRESHOLD)}; the 5-year product is shown`
          : `the 1-year product was requested, but population ${fmt(input.population)} is below the ACS 1-year threshold of ${fmt(ACS_ONE_YEAR_THRESHOLD)}; the 5-year product is shown`,
    };
  }
  if (eligible && input.population !== null) {
    return {
      product: "1-year",
      reason: `population ${fmt(input.population)} is at or above the ACS 1-year threshold of ${fmt(ACS_ONE_YEAR_THRESHOLD)}`,
    };
  }
  return {
    product: "5-year",
    reason:
      input.population === null
        ? "this area's population is unknown to the catalog, so the 5-year product (published for every area) is shown"
        : `population ${fmt(input.population)} is below the ACS 1-year threshold of ${fmt(ACS_ONE_YEAR_THRESHOLD)}`,
  };
}

/** Census annotation values (docs/spikes/m8-census.md, verified against the Census reference). */
const ESTIMATE_SENTINELS: Record<string, string> = {
  "-666666666":
    "the estimate could not be computed (insufficient sample observations, or a median in an open-ended distribution extreme)",
  "-999999999":
    "the estimate cannot be displayed because there were an insufficient number of sample cases",
  "-888888888": "the estimate is not applicable or not available",
};
const MARGIN_SENTINELS: Record<string, string> = {
  "-222222222": "the margin of error could not be computed (insufficient sample observations)",
  "-333333333":
    "the margin of error could not be computed (median in an open-ended distribution extreme)",
  "-555555555":
    "the estimate is controlled to an independent population or housing estimate, so no margin of error applies",
  "-888888888": "the margin of error is not applicable or not available",
  "-999999999":
    "the margin of error cannot be displayed because there were an insufficient number of sample cases",
};

export interface AcsParsed {
  name: string;
  value: number | null;
  marginOfError: number | null;
  caveats: string[];
}

/** Parse one-variable query text; null for an empty body (the API answers 204 when a product does not cover the area). */
export function parseAcsResponse(text: string, variable: string): AcsParsed | null {
  if (text.trim() === "") return null;
  const rows = JSON.parse(text) as (string | null)[][];
  const header = rows[0] ?? [];
  const data = rows[1];
  if (!data) return null;
  const col = (name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (data[i] ?? null) : null;
  };
  const e = col(`${variable}E`);
  const m = col(`${variable}M`);
  const ea = col(`${variable}EA`);
  const ma = col(`${variable}MA`);
  const caveats: string[] = [];

  let value: number | null = null;
  if (e === null) {
    caveats.push("no data is available for this geography");
  } else if (ESTIMATE_SENTINELS[e]) {
    caveats.push(ESTIMATE_SENTINELS[e] ?? "");
  } else {
    const n = Number(e.replace(/[,+-]+$/, ""));
    value = Number.isFinite(n) ? n : null;
    if (ea === "+" || /\+$/.test(e))
      caveats.push(
        "the median falls in the highest open-ended interval; the true value is at or above the figure shown",
      );
    else if (ea === "-" && value !== null)
      caveats.push(
        "the median falls in the lowest open-ended interval; the true value is at or below the figure shown",
      );
    if (value === null) caveats.push(`the estimate "${e}" could not be read as a number`);
  }

  let marginOfError: number | null = null;
  if (value !== null) {
    if (m === null) {
      caveats.push("no margin of error was published");
    } else if (MARGIN_SENTINELS[m]) {
      caveats.push(MARGIN_SENTINELS[m] ?? "");
    } else {
      const n = Number(m);
      marginOfError = Number.isFinite(n) ? n : null;
    }
  }
  if (ma === "N" || ea === "N") caveats.push("insufficient sample cases (Census annotation N)");
  return { name: col("NAME") ?? "", value, marginOfError, caveats: [...new Set(caveats)] };
}

/** Reliability from the coefficient of variation (MOE at 90% → standard error = MOE / 1.645). */
export function reliabilityOf(
  value: number | null,
  marginOfError: number | null,
): { grade: "high" | "medium" | "low"; cv: number } | undefined {
  if (value === null || marginOfError === null || value <= 0) return undefined;
  const cv = marginOfError / 1.645 / value;
  return { grade: cv < 0.12 ? "high" : cv <= 0.4 ? "medium" : "low", cv };
}

function periodOf(q: AcsQuery): { period: string; periodName: string } {
  if (q.product === "1-year") return { period: "A01", periodName: q.vintage };
  const start = String(Number(q.vintage) - 4);
  return { period: "5Y", periodName: `${start}–${q.vintage}` };
}

/** One ACS observation for a parsed row. */
function toObservation(q: AcsQuery, parsed: AcsParsed, extra: string[]): SeriesObservation {
  const { period, periodName } = periodOf(q);
  const rel = reliabilityOf(parsed.value, parsed.marginOfError);
  const footnotes = [...extra, ...parsed.caveats].map((text) => ({ code: "ACS", text }));
  if (rel?.grade === "low") {
    footnotes.push({
      code: "ACS",
      text: `low reliability: the coefficient of variation is ${Math.round(rel.cv * 100)}%; treat this estimate as indicative`,
    });
  }
  return {
    year: q.vintage,
    period,
    periodName,
    value: parsed.value,
    footnotes,
    marginOfError: parsed.marginOfError,
    ...(rel ? { reliability: rel.grade } : {}),
  };
}

/**
 * Fetch one variable per key. A 1-year query the API answers with no row (HTTP 204: the area is
 * below 65,000) is retried on the 5-year product and the observation says so.
 */
export const acsFetch: IndicatorFetch = async (client, keys, options): Promise<SeriesResult[]> => {
  const results: SeriesResult[] = [];
  const request = {
    freshTtlSeconds: ACS_CACHE_TTL_SECONDS,
    ...(options.apiKey ? { queryAuth: { key: options.apiKey } } : {}),
  };
  for (const key of keys) {
    const q = parseAcsSeriesKey(key);
    if (!q) {
      results.push({ seriesId: key, observations: [] });
      continue;
    }
    let parsed = parseAcsResponse(
      (await client.getText(buildAcsQueryUrl(q), request)).value,
      q.variable,
    );
    let served = q;
    const extra: string[] = [];
    if (!parsed && q.product === "1-year") {
      served = { ...q, product: "5-year" };
      parsed = parseAcsResponse(
        (await client.getText(buildAcsQueryUrl(served), request)).value,
        q.variable,
      );
      extra.push(
        `ACS 1-year estimates are not published for this area (below ${ACS_ONE_YEAR_THRESHOLD.toLocaleString("en-US")} people); the 5-year ${periodOf(served).periodName} estimate is shown`,
      );
    }
    results.push({
      seriesId: key,
      observations: parsed ? [toObservation(served, parsed, extra)] : [],
    });
  }
  return results;
};

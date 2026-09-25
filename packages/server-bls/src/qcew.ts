import { type HttpClient, HttpError, type RequestOptions } from "@federal-mcps/core";
import { QCEW_ENDPOINT } from "./describe-source.js";

/**
 * QCEW (Quarterly Census of Employment and Wages) CSV area-slice client (ADR-011 §1). QCEW has no
 * series id: an area's quarter is a CSV slice, and a value is selected by ownership, industry and
 * aggregation level. This module fetches the slice through the core HTTP client (`getText`, cached —
 * no direct `fetch`, CLAUDE.md), parses it, and returns the total-covered, all-industries headline
 * row. Suppressed cells (a `disclosure_code`) carry the code as a caveat with a null value, never a
 * fabricated number (ADR-011 §5). Open data, no key, no daily cap.
 */

/** Total covered ownership (all ownerships combined). */
export const OWN_TOTAL_COVERED = "0";
/** All industries (NAICS total). */
export const INDUSTRY_ALL = "10";

/**
 * QCEW aggregation-level codes (ADR-013 §2), county and state (M5 scope, ADR-011 §3). A value is
 * selected by own_code + industry_code, but that pair alone can match more than one row (e.g. a
 * NAICS domain code); agglvl_code disambiguates by naming the geography level and depth. Verified
 * 2026-09-17 against the live QCEW API and the agglvl titles reference
 * (https://data.bls.gov/cew/doc/titles/agglevel/agglevel_titles.htm):
 *   curl -s https://data.bls.gov/cew/data/api/2024/1/area/08031.csv | awk -F',' '{print $2","$3","$4}' | sort -u
 *   curl -s https://data.bls.gov/cew/data/api/2024/1/area/08000.csv | awk -F',' '{print $2","$3","$4}' | sort -u
 * County: total (own 0, industry 10) → agglvl "70"; by ownership (industry 10, own != 0) → "71";
 * NAICS sector by ownership (industry a sector code, e.g. "23") → "74" (QCEW does not publish a
 * total-ownership row at the sector level — own_code 0 never appears at agglvl 74). State: the same
 * pattern one level up — total "50", by ownership "51", sector "54".
 */
const COUNTY_AGGLVL = { total: "70", ownership: "71", sector: "74" } as const;
const STATE_AGGLVL = { total: "50", ownership: "51", sector: "54" } as const;
/** MSA (`C`-code areas, #153): verified live 2026-09-17 on C1974 (Denver): 40 / 41 / 44. */
const MSA_AGGLVL = { total: "40", ownership: "41", sector: "44" } as const;

type QcewAreaLevel = "county" | "state" | "msa";

/** A QCEW area's geography level, inferred from its area_fips shape (county 5-digit, state SS000, MSA C####). */
function qcewAreaLevel(areaFips: string): QcewAreaLevel | undefined {
  if (/^C\d{4}$/.test(areaFips)) return "msa";
  if (/^\d{2}000$/.test(areaFips)) return "state";
  if (/^\d{5}$/.test(areaFips)) return "county";
  return undefined;
}

/**
 * The agglvl_code a (level, own_code, industry_code) selection should land on. Detailed NAICS
 * (#213) sits one level per digit below the sector: verified live 2026-09-24 on St. Joseph County
 * IN (23 → 74, 236 → 75, 2361 → 76, 23611 → 77, 236118 → 78), Indiana (54–58) and the Denver
 * metro C1974 (44–48).
 */
function expectedAgglvl(level: QcewAreaLevel, ownCode: string, industryCode: string): string {
  const set = level === "state" ? STATE_AGGLVL : level === "msa" ? MSA_AGGLVL : COUNTY_AGGLVL;
  if (/^\d{3,6}$/.test(industryCode)) {
    return String(Number(set.sector) + (industryCode.length - 2));
  }
  if (industryCode !== INDUSTRY_ALL) return set.sector;
  return ownCode === OWN_TOTAL_COVERED ? set.total : set.ownership;
}

/** Which row to pick from an area's slice: an ownership code and an industry code (ADR-013 §2). */
export interface QcewRowSelection {
  ownCode: string;
  industryCode: string;
}

const HEADLINE_SELECTION: QcewRowSelection = {
  ownCode: OWN_TOTAL_COVERED,
  industryCode: INDUSTRY_ALL,
};

/** A QCEW quarter for an area (calendar quarter 1–4). */
export interface QcewQuarter {
  year: number;
  quarter: number;
}

/** The total-covered, all-industries headline for one area and quarter. */
export interface QcewHeadline {
  areaFips: string;
  year: number;
  quarter: number;
  /** Quarterly employment: the average of the three monthly levels; null if suppressed. */
  employment: number | null;
  /** Average weekly wage (dollars); null if suppressed. */
  averageWeeklyWage: number | null;
  /** Establishment count; null if suppressed. */
  establishments: number | null;
  /** QCEW disclosure code: "" when published, otherwise a suppression flag (e.g. "N"). */
  disclosureCode: string;
  /** True for an annual-averages row (#213); `quarter` is then 0. */
  annual?: boolean;
}

/** The first year the QCEW open data slices serve (verified 2026-09-24: 2013 returns 404). */
export const EARLIEST_QCEW_YEAR = 2014;

/** Plain-language text for QCEW disclosure codes (ADR-011 §5). */
export function qcewDisclosureText(code: string): string | undefined {
  if (!code) return undefined;
  const KNOWN: Record<string, string> = {
    N: "not disclosable — withheld for employer confidentiality",
  };
  return KNOWN[code] ?? `withheld (QCEW disclosure code ${code})`;
}

/** The annual-averages CSV for an area and year (#213). */
export function qcewAnnualUrl(area: string, year: number): string {
  return `${QCEW_ENDPOINT}/${year}/a/area/${area}.csv`;
}

/** The CSV slice URL for an area and quarter. */
export function qcewAreaUrl(area: string, { year, quarter }: QcewQuarter): string {
  return `${QCEW_ENDPOINT}/${year}/${quarter}/area/${area}.csv`;
}

/** Split one CSV line, stripping surrounding double-quotes from each field (QCEW quotes strings). */
function splitCsvLine(line: string): string[] {
  return line.split(",").map((f) => f.trim().replace(/^"(.*)"$/, "$1"));
}

function toNum(field: string | undefined): number | null {
  if (field === undefined || field === "") return null;
  const n = Number.parseFloat(field);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a QCEW area CSV and return the row selected by own_code + industry_code, disambiguated by
 * the matching agglvl_code (ADR-013 §2) — undefined when the slice has zero or more than one
 * candidate row (this never guesses; ADR-011 §5's "never fabricated" extends to row selection, not
 * only suppressed cells). Defaults to the total-covered, all-industries headline. A suppressed row
 * (disclosure code set) yields null measures — never a fabricated value.
 */
export function parseQcewRow(
  csv: string,
  selection: QcewRowSelection = HEADLINE_SELECTION,
): QcewHeadline | undefined {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.shift();
  if (!header) return undefined;
  const cols = splitCsvLine(header);
  const idx = (name: string) => cols.indexOf(name);
  const iOwn = idx("own_code");
  const iInd = idx("industry_code");
  const iAgg = idx("agglvl_code");
  if (iOwn < 0 || iInd < 0) return undefined;

  // An annual-averages file (#213) names its measures differently: one employment level, and
  // annual_avg_* for establishments and the weekly wage.
  const annual = idx("annual_avg_emplvl") >= 0;
  const at = {
    area: idx("area_fips"),
    year: idx("year"),
    qtr: idx("qtr"),
    disc: idx("disclosure_code"),
    estabs: annual ? idx("annual_avg_estabs") : idx("qtrly_estabs"),
    m1: idx("month1_emplvl"),
    m2: idx("month2_emplvl"),
    m3: idx("month3_emplvl"),
    annualEmp: idx("annual_avg_emplvl"),
    wage: annual ? idx("annual_avg_wkly_wage") : idx("avg_wkly_wage"),
  };

  const rows = lines
    .map(splitCsvLine)
    .filter((f) => f[iOwn] === selection.ownCode && f[iInd] === selection.industryCode);
  if (rows.length === 0) return undefined;

  let candidates = rows;
  if (iAgg >= 0) {
    const level = qcewAreaLevel(rows[0]?.[at.area] ?? "");
    if (level) {
      const agglvl = expectedAgglvl(level, selection.ownCode, selection.industryCode);
      const filtered = rows.filter((f) => f[iAgg] === agglvl);
      if (filtered.length > 0) candidates = filtered;
    }
  }
  if (candidates.length !== 1) return undefined;

  const f = candidates[0] as string[];
  const disclosureCode = f[at.disc] ?? "";
  const suppressed = disclosureCode !== "";
  const months = [toNum(f[at.m1]), toNum(f[at.m2]), toNum(f[at.m3])].filter(
    (m): m is number => m !== null,
  );
  const employment = annual
    ? suppressed
      ? null
      : toNum(f[at.annualEmp])
    : suppressed || months.length < 3
      ? null
      : Math.round(months.reduce((a, b) => a + b, 0) / 3);
  return {
    ...(annual ? { annual: true } : {}),
    areaFips: f[at.area] ?? "",
    year: Number.parseInt(f[at.year] ?? "0", 10),
    quarter: annual ? 0 : Number.parseInt(f[at.qtr] ?? "0", 10),
    employment,
    averageWeeklyWage: suppressed ? null : toNum(f[at.wage]),
    establishments: suppressed ? null : toNum(f[at.estabs]),
    disclosureCode,
  };
}

/**
 * Parse a QCEW area CSV and return its total-covered, all-industries headline row. Kept as the
 * pre-#151 entry point; equivalent to `parseQcewRow(csv)`.
 */
export function parseQcewHeadline(csv: string): QcewHeadline | undefined {
  return parseQcewRow(csv);
}

/**
 * Fetch an area's quarter slice and parse the row selected by `selection` (default: total-covered,
 * all-industries), through the core client (`getText`, long-TTL cache — the quarter is fixed once
 * released, so the cache key is unaffected by which row is later picked from it). Returns undefined
 * when the slice is empty/unavailable (e.g. the quarter is not yet published) or when `selection`
 * matches no unique row.
 */
export async function fetchQcewRow(
  client: HttpClient,
  area: string,
  quarter: QcewQuarter,
  selection: QcewRowSelection = HEADLINE_SELECTION,
  options: { freshTtlSeconds?: number } = {},
): Promise<QcewHeadline | undefined> {
  const reqOptions: RequestOptions =
    options.freshTtlSeconds === undefined ? {} : { freshTtlSeconds: options.freshTtlSeconds };
  const { value } = await client.getText(qcewAreaUrl(area, quarter), reqOptions);
  if (!value || value.trim().length === 0) return undefined;
  return parseQcewRow(value, selection);
}

/**
 * Fetch one QCEW CSV (a quarter slice or an annual file) through the core client, long-TTL
 * cached. Undefined when the period is not published yet: BLS serves those as a header-only file
 * (e.g. metro slices lag counties; verified 2026-09-24), an empty body, or — for an annual file
 * — HTTP 404 (#213).
 */
export async function fetchQcewCsv(
  client: HttpClient,
  url: string,
  options: { freshTtlSeconds?: number } = {},
): Promise<string | undefined> {
  const reqOptions: RequestOptions =
    options.freshTtlSeconds === undefined ? {} : { freshTtlSeconds: options.freshTtlSeconds };
  let value: string;
  try {
    ({ value } = await client.getText(url, reqOptions));
  } catch (error) {
    // An unpublished annual file is a 404 (quarter slices come back header-only instead).
    if (error instanceof HttpError && error.status === 404) return undefined;
    throw error;
  }
  if (!value) return undefined;
  const lines = value.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.length > 1 ? value : undefined;
}

/**
 * Fetch and parse the total-covered, all-industries headline for one area and quarter. Kept as the
 * pre-#151 entry point; equivalent to `fetchQcewRow(client, area, quarter, undefined, options)`.
 */
export async function fetchQcewHeadline(
  client: HttpClient,
  area: string,
  quarter: QcewQuarter,
  options: { freshTtlSeconds?: number } = {},
): Promise<QcewHeadline | undefined> {
  return fetchQcewRow(client, area, quarter, HEADLINE_SELECTION, options);
}

/**
 * The latest QCEW quarter that should be published, from `now`. QCEW lags roughly two quarters
 * (~5–6 months); we step back six months and take that calendar quarter. Callers should tolerate an
 * empty slice by trying the prior quarter, since the exact release date varies.
 */
export function latestPublishedQuarter(now: Date): QcewQuarter {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - 6);
  return { year: d.getUTCFullYear(), quarter: Math.floor(d.getUTCMonth() / 3) + 1 };
}

/** The quarter before the given one (Q1 → prior year's Q4). */
export function priorQuarter({ year, quarter }: QcewQuarter): QcewQuarter {
  return quarter > 1 ? { year, quarter: quarter - 1 } : { year: year - 1, quarter: 4 };
}

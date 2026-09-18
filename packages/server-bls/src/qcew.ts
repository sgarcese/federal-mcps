import type { HttpClient, RequestOptions } from "@federal-mcps/core";
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

/** A QCEW area's geography level, inferred from its area_fips shape (county 5-digit, state SS000). */
function qcewAreaLevel(areaFips: string): "county" | "state" | undefined {
  if (/^\d{2}000$/.test(areaFips)) return "state";
  if (/^\d{5}$/.test(areaFips)) return "county";
  return undefined;
}

/** The agglvl_code a (level, own_code, industry_code) selection should land on. */
function expectedAgglvl(level: "county" | "state", ownCode: string, industryCode: string): string {
  const set = level === "state" ? STATE_AGGLVL : COUNTY_AGGLVL;
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
}

/** Plain-language text for QCEW disclosure codes (ADR-011 §5). */
export function qcewDisclosureText(code: string): string | undefined {
  if (!code) return undefined;
  const KNOWN: Record<string, string> = {
    N: "not disclosable — withheld for employer confidentiality",
  };
  return KNOWN[code] ?? `withheld (QCEW disclosure code ${code})`;
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

  const at = {
    area: idx("area_fips"),
    year: idx("year"),
    qtr: idx("qtr"),
    disc: idx("disclosure_code"),
    estabs: idx("qtrly_estabs"),
    m1: idx("month1_emplvl"),
    m2: idx("month2_emplvl"),
    m3: idx("month3_emplvl"),
    wage: idx("avg_wkly_wage"),
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
  const employment =
    suppressed || months.length < 3 ? null : Math.round(months.reduce((a, b) => a + b, 0) / 3);
  return {
    areaFips: f[at.area] ?? "",
    year: Number.parseInt(f[at.year] ?? "0", 10),
    quarter: Number.parseInt(f[at.qtr] ?? "0", 10),
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

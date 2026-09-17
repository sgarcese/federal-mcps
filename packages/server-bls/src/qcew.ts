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
const OWN_TOTAL_COVERED = "0";
/** All industries (NAICS total). */
const INDUSTRY_ALL = "10";

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
 * Parse a QCEW area CSV and return its total-covered, all-industries headline row, or undefined if
 * the slice has no such row (an area with no published total). A suppressed row (disclosure code
 * set) yields null measures — never a fabricated value.
 */
export function parseQcewHeadline(csv: string): QcewHeadline | undefined {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.shift();
  if (!header) return undefined;
  const cols = splitCsvLine(header);
  const idx = (name: string) => cols.indexOf(name);
  const iOwn = idx("own_code");
  const iInd = idx("industry_code");
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

  for (const line of lines) {
    const f = splitCsvLine(line);
    if (f[iOwn] !== OWN_TOTAL_COVERED || f[iInd] !== INDUSTRY_ALL) continue;
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
  return undefined;
}

/**
 * Fetch and parse the total-covered, all-industries headline for one area and quarter, through the
 * core client (`getText`, long-TTL cache — the quarter is fixed once released). Returns undefined
 * when the slice is empty/unavailable (e.g. the quarter is not yet published).
 */
export async function fetchQcewHeadline(
  client: HttpClient,
  area: string,
  quarter: QcewQuarter,
  options: { freshTtlSeconds?: number } = {},
): Promise<QcewHeadline | undefined> {
  const reqOptions: RequestOptions =
    options.freshTtlSeconds === undefined ? {} : { freshTtlSeconds: options.freshTtlSeconds };
  const { value } = await client.getText(qcewAreaUrl(area, quarter), reqOptions);
  if (!value || value.trim().length === 0) return undefined;
  return parseQcewHeadline(value);
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

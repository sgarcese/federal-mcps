/**
 * The BEA Regional API seam (#258, ADR-019): the GetData URL (a fixed parameter order — fixtures
 * hash the exact URL), the keyed fetch through the core client, the client hooks BEA needs, and the
 * one place a BEA data row becomes an observation. Every indicator family (#259–#261) builds on
 * these; none parses BEA's JSON itself.
 *
 * Verified live 2026-09-28 (docs/spikes/m14-bea-regional.md):
 *   - the key rides as the `UserID` query parameter AND is echoed in every body (`BEAAPI.Request`);
 *   - errors come back as HTTP 200 with `BEAAPI.Results.Error.APIErrorCode` (4 inactive key,
 *     40 bad parameter, 101 unknown), and count against a 30-errors-a-minute budget;
 *   - a suppressed or unavailable cell is `DataValue "0"` with a parenthesized `NoteRef`
 *     (`(D)`, `(NA)`); units are per row (`CL_UNIT`, `UNIT_MULT`);
 *   - annual periods are "2024", quarterly "2026Q1".
 */
import type { HttpClient, SeriesObservation } from "@federal-mcps/core";
import { BEA_API_ENDPOINT } from "./describe-source.js";

/** BEA publishes on a schedule and states each release's vintage in band: cache for 7 days (ADR-019 §8). */
export const BEA_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Under BEA's 100 requests a minute (ADR-019 §4). */
export const BEA_PER_MINUTE = 90;

/**
 * Under BEA's 30 errors a minute (ADR-019 §4, #324, ADR-020 §2): BEA may block a key that trips
 * this budget, so the core client's error limiter (`errorsPerMinute`) refuses further calls
 * itself once reached, without ever reaching BEA again that minute.
 */
export const BEA_ERRORS_PER_MINUTE = 30;

/** BEA error codes that mean "try again later"; every other code is a bad request, never retried. */
const RETRYABLE_ERROR_CODES = new Set(["7"]);

interface BeaEnvelope {
  BEAAPI?: {
    Request?: unknown;
    Error?: { APIErrorCode?: string; APIErrorDescription?: string };
    Results?: {
      Error?: {
        APIErrorCode?: string;
        APIErrorDescription?: string;
        ErrorDetail?: { Description?: string };
      };
    } & BeaResults;
  };
}

/** One GetData data row, as BEA sends it (all strings). */
export interface BeaDataRow {
  Code: string;
  GeoFips: string;
  GeoName: string;
  TimePeriod: string;
  DataValue: string;
  CL_UNIT?: string;
  UNIT_MULT?: string;
  NoteRef?: string | null;
}

/** A GetData result: rows, notes, and the table's own labels. */
export interface BeaResults {
  Statistic?: string;
  UnitOfMeasure?: string;
  PublicTable?: string;
  Data?: BeaDataRow[];
  Notes?: { NoteRef: string; NoteText: string }[];
}

/**
 * The core client's `sanitize` hook for BEA: drops `BEAAPI.Request`, where BEA echoes the caller's
 * key, before a body is recorded, parsed, cached or returned. A body that is not BEA JSON passes
 * through unchanged.
 */
export function sanitizeBeaBody(body: string): string {
  try {
    const json = JSON.parse(body) as BeaEnvelope;
    if (!json.BEAAPI || !("Request" in json.BEAAPI)) return body;
    delete json.BEAAPI.Request;
    return JSON.stringify(json);
  } catch {
    return body;
  }
}

/** The core client's `bodyError` hook for BEA: an `APIErrorCode` in a 200 body is an error. */
export function beaBodyError(
  body: string,
): { code: string; message: string; retryable: boolean } | undefined {
  let json: BeaEnvelope;
  try {
    json = JSON.parse(body) as BeaEnvelope;
  } catch {
    return undefined;
  }
  const error = json.BEAAPI?.Results?.Error ?? json.BEAAPI?.Error;
  if (!error?.APIErrorCode) return undefined;
  const detail =
    json.BEAAPI?.Results?.Error?.ErrorDetail?.Description ?? error.APIErrorDescription ?? "";
  return {
    code: error.APIErrorCode,
    message: detail,
    retryable: RETRYABLE_ERROR_CODES.has(error.APIErrorCode),
  };
}

/** What one GetData call asks for. `geoFips` is one code, a comma list, or a special value. */
export interface BeaQuery {
  table: string;
  lineCode: string | number;
  geoFips: string | readonly string[];
  /** Years ("2024"), a list, or "LAST5" / "LAST10" / "ALL". Omitted → BEA's default LAST5. */
  year?: string | readonly (string | number)[];
}

/** The GetData URL, key-less (the key rides as `queryAuth`). Parameter order is fixed: fixtures hash it. */
export function beaDataUrl(q: BeaQuery): string {
  const geo = typeof q.geoFips === "string" ? q.geoFips : q.geoFips.join(",");
  const params = [
    "method=GetData",
    "datasetname=Regional",
    `TableName=${encodeURIComponent(q.table)}`,
    `LineCode=${encodeURIComponent(String(q.lineCode))}`,
    `GeoFips=${encodeURIComponent(geo).replace(/%2C/g, ",")}`,
  ];
  if (q.year !== undefined) {
    const year = typeof q.year === "string" ? q.year : q.year.join(",");
    params.push(`Year=${encodeURIComponent(year).replace(/%2C/g, ",")}`);
  }
  params.push("ResultFormat=JSON");
  return `${BEA_API_ENDPOINT}?${params.join("&")}`;
}

/**
 * Runs one GetData query through the core client (limiter, 7-day cache, sanitize and error hooks
 * configured on the client) with the key as `queryAuth`. Throws when no key is configured.
 */
export async function beaGetData(
  client: HttpClient,
  query: BeaQuery,
  apiKey: string | undefined,
): Promise<BeaResults> {
  if (!apiKey) {
    throw new Error(
      "BEA_API_KEY is not set: every BEA Data API call needs a registered, activated key (ADR-019 §3).",
    );
  }
  const { value } = await client.getJson<BeaEnvelope>(beaDataUrl(query), {
    queryAuth: { UserID: apiKey },
    freshTtlSeconds: BEA_CACHE_TTL_SECONDS,
  });
  return value.BEAAPI?.Results ?? {};
}

/** A parenthesized NoteRef marker — "(D)", "(NA)" — means the cell is not a number. */
const MARKER = /\([A-Z]+\)/g;

/**
 * One data row as an observation (ADR-019 §5): a row carrying a parenthesized marker is a null
 * value with the marker's own note text as a footnote — never BEA's placeholder `0`. Annual
 * periods ("2024") map to `A01`, quarterly ("2026Q1") to `Q01`–`Q04`. `DataValue` is scaled by
 * nothing: the unit (with its multiplier) travels separately, from `unitOf`.
 */
export function beaObservation(
  row: BeaDataRow,
  notes: readonly { NoteRef: string; NoteText: string }[] = [],
): SeriesObservation {
  const quarter = /^(\d{4})Q([1-4])$/.exec(row.TimePeriod);
  const year = quarter?.[1] ?? row.TimePeriod.slice(0, 4);
  const period = quarter ? `Q0${quarter[2]}` : "A01";
  const periodName = quarter ? `${year} Q${quarter[2]}` : year;
  const markers = [...new Set((row.NoteRef ?? "").match(MARKER) ?? [])];
  const footnotes = markers.map((code) => ({
    code,
    text: notes.find((n) => n.NoteRef.trim() === code)?.NoteText ?? `BEA marks this value ${code}.`,
  }));
  const parsed = Number(row.DataValue.replace(/,/g, ""));
  const value = markers.length > 0 || !Number.isFinite(parsed) ? null : parsed;
  return { year, period, periodName, value, footnotes };
}

/** A row's unit, with BEA's multiplier spelled out ("Thousands of dollars" stays as BEA says it). */
export function unitOf(row: BeaDataRow, results: BeaResults): string {
  return row.CL_UNIT ?? results.UnitOfMeasure ?? "";
}

/**
 * The release note every answer carries (ADR-019 §8): BEA's own "Last updated: … — new statistics
 * for …; revised statistics for …", or undefined when the response has none.
 */
export function vintageNote(results: BeaResults): string | undefined {
  const note = results.Notes?.find((n) => /^Last updated/i.test(n.NoteText.trim()));
  return note ? `BEA: ${note.NoteText.trim()}` : undefined;
}

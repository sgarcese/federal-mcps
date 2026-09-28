import {
  buildCitation,
  type CompactRendering,
  type HttpClient,
  RAW_TEXT_BUDGET,
  type ToolDefinition,
  type ToolHandlerResult,
} from "@federal-mcps/core";
import { z } from "zod";
import { type BeaDataRow, beaDataUrl, beaGetData, vintageNote } from "./bea-api.js";
import { BEA_REQUIRED_SENTENCE } from "./describe-source.js";

/**
 * `bea_get_raw` (#262, ADR-019 §9, ADR-017): one BEA Regional GetData query in BEA's own grammar —
 * a table, a line code (or `ALL` for one place), GeoFips codes or a bulk value, and years or a span —
 * through the core client (limiter, 7-day cache, the echoed key stripped, 200-body errors raised),
 * BEA's rows returned unchanged. One call can answer every county (verified: 3,149 areas, 486 KB),
 * so at most one parameter may be bulk: BEA's own advice is not to overuse `ALL`.
 */

/** Bulk GeoFips values: every state, county, metro, metro/nonmetro portion, or territory. */
const BULK_GEOFIPS = new Set(["STATE", "COUNTY", "MSA", "PORT", "TERR"]);

const GEOFIPS_RE = /^(\d{5}|STATE|COUNTY|MSA|PORT|TERR|[A-Z]{2})$/;

export const BeaGetRawInput = z
  .object({
    table: z
      .string()
      .regex(
        /^[A-Z]{2,8}[A-Za-z0-9-]*$/,
        "table is a BEA Regional TableName, e.g. 'CAINC1', 'SAGDP9', 'MARPP'",
      )
      .describe(
        "BEA Regional TableName, e.g. 'CAINC1' (county income), 'CAGDP9' (county real GDP), 'MARPP' (metro price parities).",
      ),
    lineCode: z
      .union([z.number().int().min(1), z.literal("ALL")])
      .describe("The table's line (statistic), e.g. 1; or 'ALL' for every line of one place."),
    ids: z
      .array(
        z
          .string()
          .regex(
            GEOFIPS_RE,
            "each id is a 5-digit GeoFips, a USPS state code (all its counties), or STATE/COUNTY/MSA/PORT/TERR",
          ),
      )
      .min(1)
      .max(50)
      .describe(
        "GeoFips codes (county FIPS, 'SS000' for a state, a CBSA for a metro), a USPS state code for all of its counties, or one bulk value: STATE, COUNTY, MSA, PORT, TERR.",
      ),
    years: z
      .array(z.number().int().min(1929).max(2100))
      .min(1)
      .max(60)
      .optional()
      .describe("Years to return. Omit for BEA's default (the last five)."),
    span: z
      .enum(["LAST5", "LAST10", "ALL"])
      .optional()
      .describe("Instead of years: the last 5 or 10 years, or ALL."),
  })
  .superRefine((v, ctx) => {
    const problem = (message: string) => ctx.addIssue({ code: "custom", message });
    if (v.years !== undefined && v.span !== undefined) problem("give `years` or `span`, not both");
    if (v.lineCode === "ALL" && (v.ids.length !== 1 || BULK_GEOFIPS.has(v.ids[0] ?? ""))) {
      problem("lineCode 'ALL' takes exactly one specific place (BEA's rule)");
    }
    const bulk =
      Number(v.lineCode === "ALL") +
      Number(v.span === "ALL") +
      Number(v.ids.some((id) => BULK_GEOFIPS.has(id)));
    if (bulk > 1)
      problem("at most one bulk parameter per call (lineCode ALL, span ALL, or a bulk GeoFips)");
    if (v.ids.some((id) => BULK_GEOFIPS.has(id)) && v.ids.length > 1) {
      problem("a bulk GeoFips value stands alone");
    }
  });

type BeaGetRawArgs = z.output<typeof BeaGetRawInput>;

interface BeaRawData {
  query: BeaGetRawArgs;
  statistic: string | null;
  unit: string | null;
  /** BEA's data rows, unchanged (the key BEA echoes is stripped by the client before this). */
  rows: BeaDataRow[];
  notes: { NoteRef: string; NoteText: string }[];
}

export interface BeaGetRawToolOptions {
  httpClient: () => HttpClient;
  /** The BEA key (`BEA_API_KEY`), sent as `queryAuth` only. */
  apiKey: () => string | undefined;
  now?: () => Date;
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Compact text (ADR-017): the statistic and unit once, the columns, then one CSV line per row. */
export function renderBeaRaw(value: unknown): CompactRendering | undefined {
  const data = value as Partial<BeaRawData> | null;
  if (!data || !Array.isArray(data.rows) || !data.query) return undefined;
  const columns = ["GeoFips", "GeoName", "TimePeriod", "DataValue", "NoteRef"] as const;
  const title = `${data.query.table} line ${data.query.lineCode}: ${data.statistic ?? "statistic"}${data.unit ? ` (${data.unit})` : ""}`;
  return {
    head: [title, `columns: ${columns.join(",")}`],
    items: data.rows.map((row) => columns.map((c) => csvField(row[c])).join(",")),
    unit: "rows",
    narrowHint:
      "Narrow the call: fewer places or a state's USPS code instead of COUNTY, fewer years, or one line instead of ALL.",
  };
}

/** `bea_get_raw`: one BEA Regional query, BEA's rows unchanged. */
export function beaGetRawTool(options: BeaGetRawToolOptions): ToolDefinition {
  const now = options.now ?? (() => new Date());
  return {
    name: "bea_get_raw",
    title: "Get raw BEA Regional data",
    description:
      "The escape hatch: run one BEA Regional query in BEA's own terms — a table (CAINC1, CAGDP2, " +
      "CAGDP9, SAINC1, SQINC1, MARPP, …), a line, places by GeoFips (or a USPS state code for all " +
      "its counties, or COUNTY/STATE/MSA for every one), and years — and get BEA's rows back " +
      "unchanged. One call answers many places. A value of 0 marked (D) or (NA) is suppressed or " +
      "unavailable, not zero. Prefer bea_get_indicator for one value with its caveats. The text reply " +
      "is compact (one line per row) up to about 24,000 characters; the full result is always in " +
      `structuredContent. ${BEA_REQUIRED_SENTENCE}`,
    input: BeaGetRawInput,
    renderData: renderBeaRaw,
    textBudget: RAW_TEXT_BUDGET,
    examples: [
      {
        title: "St. Joseph County, IN: per capita personal income 2021–2024",
        input: { table: "CAINC1", lineCode: 3, ids: ["18141"], years: [2021, 2022, 2023, 2024] },
      },
      {
        title: "South Bend and Chicago metros: regional price parities, all items",
        input: { table: "MARPP", lineCode: 1, ids: ["43780", "16980"] },
      },
    ],
    handler: async (args): Promise<ToolHandlerResult<BeaRawData>> => {
      const query = BeaGetRawInput.parse(args);
      const year = query.years ?? query.span;
      const beaQuery = {
        table: query.table,
        lineCode: query.lineCode,
        geoFips: query.ids,
        ...(year !== undefined ? { year: Array.isArray(year) ? year.map(String) : year } : {}),
      };
      const url = beaDataUrl(beaQuery);
      const results = await beaGetData(options.httpClient(), beaQuery, options.apiKey());
      const rows = results.Data ?? [];
      const markers = [
        ...new Set(rows.flatMap((r) => (r.NoteRef ?? "").match(/\([A-Z]+\)/g) ?? [])),
      ];
      const limitations = [
        ...(vintageNote(results) ? [vintageNote(results) as string] : []),
        ...(markers.length > 0
          ? [
              `BEA reports ${markers.join(", ")} cells as DataValue 0 with that marker: a suppressed or unavailable value, not a zero (see the table's notes).`,
            ]
          : []),
      ];
      const citation = `${buildCitation({ agency: "bea", program: query.table, ids: [url], url }, now())} ${BEA_REQUIRED_SENTENCE}`;
      return {
        data: {
          query,
          statistic: results.Statistic ?? null,
          unit: results.UnitOfMeasure ?? null,
          rows,
          notes: results.Notes ?? [],
        },
        source: { agency: "bea", program: query.table, ids: [url], url, citation },
        ...(limitations.length > 0 ? { limitations } : {}),
      };
    },
  };
}

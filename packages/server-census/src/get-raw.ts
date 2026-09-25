import {
  buildCitation,
  type CompactRendering,
  type HttpClient,
  RAW_TEXT_BUDGET,
  type ToolDefinition,
  type ToolHandlerResult,
} from "@federal-mcps/core";
import { z } from "zod";
import { CENSUS_API_ENDPOINT } from "./describe-source.js";

/**
 * `census_get_raw` (ADR-014 §8, #174): the escape hatch that carries the Census Data API's own
 * query grammar — `dataset`, `year`, `get` (variables and/or a `group(ID)`), `for`/`in`/`ucgid`,
 * predicates and `descriptive` — through the core client, unprocessed rows back. The grammar is
 * borrowed as data from the official `uscensusbureau/us-census-bureau-data-api-mcp` server
 * (`docs/spikes/census-server-suitability.md`, credited in NOTICE), not its code.
 */

const CENSUS_GET_RAW_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

const DATASET_RE = /^[a-z0-9]+(\/[a-z0-9]+){1,3}$/;
/** A variable id (`B19013_001E`, `NAME`) or a table group given as `group(B19013)`. */
const ID_RE = /^([A-Z][A-Z0-9_]{2,}[EMA]{0,2}|group\([A-Z][A-Z0-9_]+\))$/;

export const CensusGetRawInput = z
  .object({
    dataset: z
      .string()
      .regex(DATASET_RE, "dataset must look like 'acs/acs5', 'acs/acs5/subject' or 'dec/pl'")
      .describe("Census dataset path, e.g. 'acs/acs5', 'acs/acs5/subject', 'dec/pl'."),
    year: z.number().int().min(2000).max(2100).describe("Vintage year, e.g. 2024."),
    ids: z
      .array(
        z
          .string()
          .regex(
            ID_RE,
            "each id must be a variable id (e.g. 'B19013_001E'), 'NAME', or a table group as 'group(B19013)'",
          ),
      )
      .min(1)
      .max(50)
      .describe(
        "Variable ids (e.g. ['NAME','B19013_001E']) and/or one group id from census_search_tables (e.g. 'group(B19013)').",
      ),
    ucgid: z
      .string()
      .optional()
      .describe("Preferred geography form: a UCGID from census_resolve_place."),
    for: z.string().optional().describe("Geography as 'level:code', e.g. 'county:031'."),
    in: z
      .string()
      .optional()
      .describe("A containing geography, only alongside `for`, e.g. 'state:08'."),
    predicates: z
      .record(z.string(), z.string())
      .optional()
      .describe("Extra API predicates, e.g. { SUMLEVEL: '050' }."),
    descriptive: z
      .boolean()
      .optional()
      .describe("Ask the API for human-readable code labels alongside raw codes. Default false."),
  })
  .refine((v) => (v.ucgid !== undefined) !== (v.for !== undefined), {
    message: "give exactly one of `ucgid` or `for`",
  })
  .refine((v) => v.in === undefined || v.for !== undefined, {
    message: "`in` is only valid alongside `for`",
  });

export type CensusGetRawArgs = z.output<typeof CensusGetRawInput>;

/** Keep `:`, `,`, `*`, `(` and `)` readable; escape everything else `encodeURIComponent` would. */
function censusEncode(value: string): string {
  return encodeURIComponent(value).replace(/%3A/g, ":").replace(/%2C/g, ",");
}

/** The query URL (no key — that rides as `queryAuth`). Order matters: fixtures hash this string. */
export function buildRawQueryUrl(args: CensusGetRawArgs): string {
  const params = [`get=${censusEncode(args.ids.join(","))}`];
  if (args.ucgid !== undefined) {
    params.push(`ucgid=${censusEncode(args.ucgid)}`);
  } else if (args.for !== undefined) {
    params.push(`for=${censusEncode(args.for)}`);
    if (args.in !== undefined) params.push(`in=${censusEncode(args.in)}`);
  }
  for (const [key, value] of Object.entries(args.predicates ?? {})) {
    params.push(`${censusEncode(key)}=${censusEncode(value)}`);
  }
  if (args.descriptive === true) params.push("descriptive=true");
  return `${CENSUS_API_ENDPOINT}/${args.year}/${args.dataset}?${params.join("&")}`;
}

interface RawQueryData {
  dataset: string;
  year: number;
  query: {
    ids: readonly string[];
    ucgid?: string;
    for?: string;
    in?: string;
    predicates?: Record<string, string>;
    descriptive: boolean;
  };
  header: readonly (string | null)[];
  rows: readonly (string | null)[][];
}

export interface CensusGetRawToolOptions {
  /** The core HTTP client for the Census Data API. */
  httpClient: () => HttpClient;
  /** The Census Data API key (required for every data query, ADR-014 §9). */
  apiKey?: () => string | undefined;
  /** Injectable clock (retrieval date). */
  now?: () => Date;
}

/** One CSV field: quoted when it holds a comma, quote or newline; null renders empty. */
function csvField(value: string | null): string {
  if (value === null) return "";
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * `census_get_raw`'s compact text (#210, ADR-017 §1): the header row once, then one CSV line per
 * row. The query itself (with its variable list) stays in structuredContent and the citation.
 */
export function renderCensusRaw(value: unknown): CompactRendering | undefined {
  const data = value as Partial<RawQueryData> | null;
  if (!data || !Array.isArray(data.header) || !Array.isArray(data.rows)) return undefined;
  return {
    head: [data.header.map(csvField).join(",")],
    items: data.rows.map((row) => row.map(csvField).join(",")),
    unit: "rows",
    narrowHint: "Narrow the call: fewer variables in `ids`, or a smaller geography in `for`/`in`.",
  };
}

/** `census_get_raw`: one Census Data API query, run through the core client, rows unchanged. */
export function censusGetRawTool(options: CensusGetRawToolOptions): ToolDefinition {
  const now = options.now ?? (() => new Date());
  return {
    name: "census_get_raw",
    title: "Get raw table",
    description:
      "The escape hatch: run one Census Data API query by dataset, vintage and variables or a " +
      "table group id (from census_search_tables), for a geography given as `ucgid` (preferred " +
      "— from census_resolve_place) or `for`/`in`. Returns the API's rows unchanged, header row " +
      "first. The text reply is a compact table (one header, one line per row) up to about " +
      "24,000 characters; the full result is always in structuredContent. For wide pulls, ask " +
      "for fewer variables or a smaller geography per call.",
    input: CensusGetRawInput,
    renderData: renderCensusRaw,
    textBudget: RAW_TEXT_BUDGET,
    examples: [
      {
        title: "Denver County median household income and its margin of error",
        input: {
          dataset: "acs/acs5",
          year: 2024,
          ids: ["NAME", "B19013_001E", "B19013_001M"],
          ucgid: "0500000US08031",
        },
      },
    ],
    handler: async (args): Promise<ToolHandlerResult<RawQueryData>> => {
      const parsed = CensusGetRawInput.parse(args);
      const url = buildRawQueryUrl(parsed);
      const key = options.apiKey?.();
      const { value: text } = await options.httpClient().getText(url, {
        freshTtlSeconds: CENSUS_GET_RAW_CACHE_TTL_SECONDS,
        ...(key ? { queryAuth: { key } } : {}),
      });

      const query: RawQueryData["query"] = {
        ids: parsed.ids,
        ...(parsed.ucgid !== undefined ? { ucgid: parsed.ucgid } : {}),
        ...(parsed.for !== undefined ? { for: parsed.for } : {}),
        ...(parsed.in !== undefined ? { in: parsed.in } : {}),
        ...(parsed.predicates !== undefined ? { predicates: parsed.predicates } : {}),
        descriptive: parsed.descriptive ?? false,
      };

      if (text.trim() === "") {
        return {
          data: { dataset: parsed.dataset, year: parsed.year, query, header: [], rows: [] },
          source: {
            agency: "census",
            program: parsed.dataset,
            ids: [url],
            url: CENSUS_API_ENDPOINT,
            citation: buildCitation(
              { agency: "census", program: parsed.dataset, ids: [url], url: CENSUS_API_ENDPOINT },
              now(),
            ),
          },
          limitations: [`no rows for that geography in ${parsed.dataset} ${parsed.year}`],
        };
      }

      const rows = JSON.parse(text) as (string | null)[][];
      const [header = [], ...dataRows] = rows;

      return {
        data: { dataset: parsed.dataset, year: parsed.year, query, header, rows: dataRows },
        source: {
          agency: "census",
          program: parsed.dataset,
          ids: [url],
          url: CENSUS_API_ENDPOINT,
          citation: buildCitation(
            { agency: "census", program: parsed.dataset, ids: [url], url: CENSUS_API_ENDPOINT },
            now(),
          ),
        },
      };
    },
  };
}

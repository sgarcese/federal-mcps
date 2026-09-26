import {
  buildCitation,
  type CompactRendering,
  type HttpClient,
  RAW_TEXT_BUDGET,
  type ToolDefinition,
  type ToolHandlerResult,
} from "@federal-mcps/core";
import { z } from "zod";
import { HUD_USER_API_ENDPOINT, HUD_USER_REQUIRED_SENTENCE } from "./describe-source.js";
import { chasUrl, fmrUrl, hudGetJson, ilUrl, mtspUrl, pictureUrl } from "./hud-api.js";

/**
 * `hud_get_raw` (#237, ADR-018 §1, ADR-017): the escape hatch over the five HUD User endpoints the
 * indicator tools read — `fmr`, `il`, `mtspil`, `chas` and `picture` — and nothing else. Each call
 * builds its URL with the same builders the indicators and the fixture recorder use, goes through
 * the core client (per-minute limit, 30-day cache, bearer token as a header), and returns HUD's
 * JSON unchanged.
 */

const ENDPOINTS = ["fmr", "il", "mtspil", "chas", "picture"] as const;
type Endpoint = (typeof ENDPOINTS)[number];

const PROGRAM_OF: Record<Endpoint, string> = {
  fmr: "FMR",
  il: "IL",
  mtspil: "MTSP",
  chas: "CHAS",
  picture: "PICTURE",
};

const CHAS_TYPES = new Set([2, 3, 5]);
const PICTURE_TYPES = new Set([3, 5, 7, 8, 9]);

export const HudGetRawInput = z
  .object({
    endpoint: z
      .enum(ENDPOINTS)
      .describe(
        "HUD User endpoint: 'fmr' (Fair Market Rents), 'il' (Income Limits), 'mtspil' (MTSP limits), 'chas' (CHAS), 'picture' (Picture of Subsidized Households).",
      ),
    ids: z
      .array(z.string().regex(/^[A-Za-z0-9]{2,20}$/, "each id is letters and digits only"))
      .min(1)
      .max(10)
      .optional()
      .describe(
        "HUD entity ids, one call each (up to 10). fmr/il/mtspil: HUD's entity id (a county is its 5-digit FIPS + '99999', e.g. '1814199999'). chas: the county or place code within the state (e.g. '141'). picture: the FIPS of the county, city or tract, or the CBSA code. Omit for a CHAS or Picture state query.",
      ),
    year: z
      .number()
      .int()
      .min(2000)
      .max(2100)
      .optional()
      .describe(
        "fmr/il/mtspil: fiscal year (default HUD's latest). picture: data year, required (2012 on).",
      ),
    release: z
      .string()
      .regex(/^\d{4}-\d{4}$/, "release is a period such as '2018-2022'")
      .optional()
      .describe("chas only: the release period, e.g. '2018-2022' (default HUD's latest)."),
    type: z
      .number()
      .int()
      .optional()
      .describe(
        "chas: 2 state, 3 county, 5 place. picture: 3 state, 5 CBSA, 7 tract, 8 city, 9 county.",
      ),
    stateId: z
      .number()
      .int()
      .min(1)
      .max(78)
      .optional()
      .describe("chas only: the state FIPS as a number (e.g. 18 for Indiana)."),
    statecode: z
      .string()
      .regex(/^[A-Z]{2}$/, "statecode is a two-letter USPS code")
      .optional()
      .describe("picture only: the state's USPS code (e.g. 'IN'); not used for a CBSA."),
  })
  .superRefine((v, ctx) => {
    const problem = (message: string) => ctx.addIssue({ code: "custom", message });
    const only = (allowed: readonly (keyof typeof v)[]) => {
      for (const key of ["ids", "year", "release", "type", "stateId", "statecode"] as const) {
        if (v[key] !== undefined && !allowed.includes(key))
          problem(`\`${key}\` does not apply to endpoint '${v.endpoint}'`);
      }
    };
    switch (v.endpoint) {
      case "fmr":
      case "il":
      case "mtspil":
        only(["ids", "year"]);
        if (v.ids === undefined) problem(`endpoint '${v.endpoint}' needs \`ids\``);
        break;
      case "chas":
        only(["type", "stateId", "ids", "release"]);
        if (v.type === undefined || !CHAS_TYPES.has(v.type))
          problem("chas needs `type` 2 (state), 3 (county) or 5 (place)");
        if (v.stateId === undefined) problem("chas needs `stateId`");
        if (v.type === 2 && v.ids !== undefined)
          problem("a chas state query (type 2) takes no `ids`");
        if (v.type !== 2 && (v.ids === undefined || !v.ids.every((id) => /^\d+$/.test(id))))
          problem("a chas county or place query needs numeric `ids`");
        break;
      case "picture":
        only(["type", "year", "statecode", "ids"]);
        if (v.type === undefined || !PICTURE_TYPES.has(v.type))
          problem("picture needs `type` 3 (state), 5 (CBSA), 7 (tract), 8 (city) or 9 (county)");
        if (v.year === undefined) problem("picture needs `year`");
        if (v.type !== 5 && v.statecode === undefined) problem("picture needs `statecode`");
        if (v.type === 3 && v.ids !== undefined)
          problem("a picture state query (type 3) takes no `ids`");
        if (v.type !== 3 && v.ids === undefined) problem("picture needs `ids`");
        break;
    }
  });

export type HudGetRawArgs = z.output<typeof HudGetRawInput>;

/**
 * One query URL, built by the same functions the indicators and the fixture recorder use. `id` is
 * one of the call's `ids`, or undefined for a CHAS or Picture state query.
 */
export function buildHudRawUrl(args: Omit<HudGetRawArgs, "ids">, id: string | undefined): string {
  switch (args.endpoint) {
    case "fmr":
      return fmrUrl(id ?? "", args.year);
    case "il":
      return ilUrl(id ?? "", args.year);
    case "mtspil":
      return mtspUrl(id ?? "", args.year);
    case "chas":
      return chasUrl(
        {
          type: args.type as 2 | 3 | 5,
          stateId: args.stateId ?? 0,
          ...(id !== undefined ? { entityId: Number(id) } : {}),
        },
        args.release,
      );
    case "picture":
      return pictureUrl(
        {
          type: args.type as 3 | 5 | 7 | 8 | 9,
          ...(args.statecode !== undefined ? { statecode: args.statecode } : {}),
          ...(id !== undefined ? { entityid: id } : {}),
        },
        args.year ?? 0,
      );
  }
}

interface HudRawResponse {
  /** The entity id this response answers (absent for a state query). */
  id?: string;
  url: string;
  /** HUD's JSON unchanged; null when HUD answered "no data" (400/404). */
  response: unknown;
}

interface HudRawData {
  endpoint: Endpoint;
  query: Omit<HudGetRawArgs, "endpoint">;
  responses: HudRawResponse[];
}

export interface HudGetRawToolOptions {
  /** The core HTTP client for the HUD User API (rate-limited per minute). */
  httpClient: () => HttpClient;
  /** The HUD User bearer token (`HUD_USER_TOKEN`); sent as a header, never recorded. */
  token: () => string | undefined;
  /** Injectable clock (retrieval date). */
  now?: () => Date;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Scalar leaves as `path: value` lines; nested objects become dotted paths. */
function fieldLines(obj: Json, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}${key}`;
    if (isObject(value)) out.push(...fieldLines(value, `${path}.`));
    else if (Array.isArray(value)) out.push(`${path}: ${JSON.stringify(value)}`);
    else out.push(`${path}: ${value === null ? "" : String(value)}`);
  }
  return out;
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The record list in a HUD body, and the metadata around it (FMR ZIPs, Picture rows, CHAS). */
function splitBody(body: unknown): { meta: Json; rows: Json[] | undefined } {
  if (Array.isArray(body)) return { meta: {}, rows: body.filter(isObject) };
  if (!isObject(body)) return { meta: {}, rows: undefined };
  if (Array.isArray(body["results"])) {
    const { results, ...meta } = body;
    return { meta, rows: (results as unknown[]).filter(isObject) };
  }
  const data = body["data"];
  if (isObject(data)) {
    if (Array.isArray(data["basicdata"])) {
      const { basicdata, ...meta } = data;
      return { meta, rows: (basicdata as unknown[]).filter(isObject) };
    }
    return { meta: data, rows: undefined };
  }
  return { meta: body, rows: undefined };
}

/**
 * One response's compact form. A body with several records (Small Area FMR ZIPs, Picture's program
 * rows) renders its metadata as `key: value` head lines, a `columns:` line, then one CSV line per
 * record. A single record (a county FMR or Income Limits block, a CHAS entity's 132 fields) renders
 * one `path: value` line per field.
 */
function renderBody(body: unknown): { head: string[]; items: string[]; unit: "rows" | "fields" } {
  const { meta, rows } = splitBody(body);
  if (rows && rows.length > 1) {
    const columns: string[] = [];
    for (const row of rows) {
      for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    }
    return {
      head: [...fieldLines(meta), `columns: ${columns.join(",")}`],
      items: rows.map((row) => columns.map((c) => csvField(row[c])).join(",")),
      unit: "rows",
    };
  }
  const record = rows?.[0] ? { ...meta, ...rows[0] } : meta;
  return { head: [], items: fieldLines(record), unit: "fields" };
}

/**
 * `hud_get_raw`'s compact text (ADR-017 §1). One response renders as its rows or fields, so the
 * shell cuts on whole rows; several render as one block per entity (`id …` then its lines), cut on
 * whole entities. With no data at all it declines, and the shell falls back to JSON.
 */
export function renderHudRaw(value: unknown): CompactRendering | undefined {
  const responses = (value as Partial<HudRawData> | null)?.responses;
  if (!Array.isArray(responses)) return undefined;
  const answered = responses.filter((r) => r.response !== null && r.response !== undefined);
  if (answered.length === 0) return undefined;
  const narrowHint =
    "Narrow the call: fewer ids, a smaller geography (a county or city rather than a state or metro), or hud_get_indicator for one value with its caveats.";
  const [only] = responses;
  if (responses.length === 1 && only) {
    return { ...renderBody(only.response), narrowHint };
  }
  return {
    head: [],
    items: responses.map((r) => {
      const label = `id ${r.id ?? "(state)"}`;
      if (r.response === null || r.response === undefined) return `${label}: no data`;
      const body = renderBody(r.response);
      return [label, ...body.head, ...body.items].join("\n");
    }),
    unit: "responses",
    narrowHint,
  };
}

/** `hud_get_raw`: one HUD User API call, through the core client, HUD's JSON unchanged. */
export function hudGetRawTool(options: HudGetRawToolOptions): ToolDefinition {
  const now = options.now ?? (() => new Date());
  return {
    name: "hud_get_raw",
    title: "Get raw HUD User response",
    description:
      "The escape hatch: call one HUD User API endpoint — fmr, il, mtspil, chas or picture — for up " +
      "to 10 entity ids with HUD's own parameters and get its JSON back unchanged (e.g. every Small Area FMR ZIP in a " +
      "county, all 132 CHAS fields, or every Picture program row). Prefer hud_get_indicator for a " +
      "single value with caveats. The text reply is compact (one line per field or row) up to " +
      "about 24,000 characters; the full result is always in structuredContent. " +
      HUD_USER_REQUIRED_SENTENCE,
    input: HudGetRawInput,
    renderData: renderHudRaw,
    textBudget: RAW_TEXT_BUDGET,
    examples: [
      {
        title: "St. Joseph County, IN: this year's Fair Market Rents, every bedroom size",
        input: { endpoint: "fmr", ids: ["1814199999"] },
      },
      {
        title: "St. Joseph County, IN: every CHAS field in the latest release",
        input: { endpoint: "chas", type: 3, stateId: 18, ids: ["141"] },
      },
    ],
    handler: async (args): Promise<ToolHandlerResult<HudRawData>> => {
      const parsed = HudGetRawInput.parse(args);
      const { endpoint, ...query } = parsed;
      const client = options.httpClient();
      const responses: HudRawResponse[] = [];
      // One call per id, in order, through the per-minute limiter (ADR-018 §5).
      for (const id of parsed.ids ?? [undefined]) {
        const url = buildHudRawUrl(parsed, id);
        const body = await hudGetJson<unknown>(client, url, options.token);
        responses.push({ ...(id !== undefined ? { id } : {}), url, response: body ?? null });
      }
      const program = PROGRAM_OF[endpoint];
      const urls = responses.map((r) => r.url);
      const url = urls.length === 1 ? (urls[0] ?? HUD_USER_API_ENDPOINT) : HUD_USER_API_ENDPOINT;
      const citation = `${buildCitation({ agency: "hud", program, ids: urls, url }, now())} ${HUD_USER_REQUIRED_SENTENCE}`;
      const missing = responses.filter((r) => r.response === null);
      return {
        data: { endpoint, query, responses },
        source: { agency: "hud", program, ids: urls, url, citation },
        ...(missing.length > 0
          ? {
              limitations: missing.map(
                (r) =>
                  `HUD User has no data for ${endpoint} ${r.id ?? "(state)"} in that year (HTTP 400/404): check the id with hud_resolve_place, and that the year is published (FMR and Income Limits FY2017 on, Picture 2012 on). New England publishes FMR and Income Limits by town, not county.`,
              ),
            }
          : {}),
      };
    },
  };
}

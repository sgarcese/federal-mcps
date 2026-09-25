import { renderBlsRaw } from "./raw-render.js";
import {
  buildCitation,
  type GeographyCatalog,
  type HttpClient,
  type IndicatorDefinition,
  indicatorTools,
  RAW_TEXT_BUDGET,
  type ToolDefinition,
  type ToolHandlerResult,
} from "@federal-mcps/core";
import { z } from "zod";
import { isSmSeriesId } from "./ces.js";
import { isCuSeriesId } from "./cpi.js";
import { BLS_TIMESERIES_ENDPOINT } from "./describe-source.js";
import { blsIndicatorDefinitions } from "./indicators.js";
import { isJtSeriesId } from "./jt.js";
import { isLausSeriesId } from "./laus.js";
import { isOeSeriesId } from "./oe.js";
import { isWpuSeriesId } from "./ppi.js";
import { fetchSeriesRaw, timeseriesFetch } from "./series-fetch.js";

export interface BlsIndicatorToolsOptions {
  /** How the handler gets a read-only catalog (cached upstream). */
  catalog: () => GeographyCatalog;
  /** The core HTTP client for the BLS API (retry/budget/cache/fixtures). */
  httpClient: () => HttpClient;
  /** The BLS registration key, when configured (production only). */
  apiKey?: () => string | undefined;
  /** Injectable clock for the retrieval date and default period. */
  now?: () => Date;
  /** The indicator definitions to register (default: every BLS program's). Injectable for tests. */
  definitions?: readonly IndicatorDefinition[];
}

const SOURCE = {
  agency: "bls",
  program: "LAUS",
  url: BLS_TIMESERIES_ENDPOINT,
};

/**
 * The shape of any BLS Public Data API timeseries id: a two-letter survey prefix, then capitals
 * and digits, 5–30 characters in all (e.g. `LNU04000000`, `CEU2000000003`, `CUUR0000SA0`). The
 * API is the authority on whether a series exists; this only keeps garbage and QCEW's internal
 * `area|own|industry` keys out of the request (#211).
 */
const BLS_SERIES_ID_SHAPE = /^[A-Z]{2}[A-Z0-9]{3,28}$/;

/**
 * A BLS timeseries id: one this server builds (LAUS, CES State & Area, OEWS, CPI, JOLTS, PPI) or
 * any other id of the BLS shape — national CES (`CE…`), CPS (`LN…`) and the rest of LABSTAT —
 * since `bls_get_raw` is the escape hatch for exact series (#211).
 */
function isBlsTimeseriesId(id: string): boolean {
  return (
    isLausSeriesId(id) ||
    isSmSeriesId(id) ||
    isOeSeriesId(id) ||
    isCuSeriesId(id) ||
    isJtSeriesId(id) ||
    isWpuSeriesId(id) ||
    BLS_SERIES_ID_SHAPE.test(id)
  );
}

/**
 * The BLS data tools: the family's generic indicator tools (core, ADR-010 §1) configured for
 * BLS — its programs' definitions, the timeseries API as the default fetch capability, and the
 * BLS-specific descriptions — plus `bls_get_raw`, the BLS-grammar escape hatch. A city below the
 * LAUS 25,000 threshold falls back to its county with an explicit caveat — never a silent
 * substitution or a fabricated city number (ADR-009 §5–§7).
 */
export function blsIndicatorTools(options: BlsIndicatorToolsOptions): ToolDefinition[] {
  const now = options.now ?? (() => new Date());
  const generic = indicatorTools({
    agency: "bls",
    definitions: options.definitions ?? blsIndicatorDefinitions,
    catalog: options.catalog,
    httpClient: options.httpClient,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    now,
    defaultFetch: timeseriesFetch,
    sourceUrl: BLS_TIMESERIES_ENDPOINT,
    sourceProgram: "LAUS",
    defaultIndicator: "unemployment_rate",
    descriptions: {
      getIndicator:
        "Get one BLS indicator for a place, with footnote flags and a citation: unemployment, employment and labor force (LAUS); payroll employment (CES); occupational wage (OEWS); the all-items price index (CPI); job openings, hires, quits and layoffs (JOLTS); covered employment and average weekly wage (QCEW); producer price indexes (PPI, national only — place optional). Coverage gaps fall back and are flagged: a city below the 25,000 LAUS threshold returns its county's value; a place with no local CPI returns the U.S. city average.",
      comparePlaces:
        "Compare one indicator across several places, aligned on the latest period they all share. Each place is resolved and labelled; a place below coverage (e.g. a small city on LAUS) is flagged with its fallback, and an ambiguous or unmatched place is reported in its row rather than dropped.",
      listIndicators:
        "List every indicator this server reports (across LAUS, CES, OEWS, CPI, JOLTS, QCEW and PPI) with its program and description. Given a place, each indicator also reports whether its program publishes at that place's level, and the fallback it would use otherwise (e.g. a small city's county, or the U.S. city average for CPI).",
    },
    examples: {
      getIndicator: [
        {
          title: "Denver County unemployment rate",
          input: { place: "Denver", kind: "county", indicator: "unemployment_rate" },
        },
      ],
      comparePlaces: [
        {
          title: "Compare unemployment across three states",
          input: { indicator: "unemployment_rate", places: ["Colorado", "Utah", "Nevada"] },
        },
      ],
      listIndicators: [
        { title: "indicators for Denver County", input: { place: "Denver", kind: "county" } },
      ],
    },
    dimensionDescriptions: {
      item: "A CPI/PPI item code from the indicator's vocabulary (bls_list_indicators).",
      industry: "A NAICS industry code from the indicator's vocabulary (bls_list_indicators).",
      ownership: "A QCEW ownership code from the indicator's vocabulary (bls_list_indicators).",
      occupation: "A SOC occupation code from the indicator's vocabulary (bls_list_indicators).",
    },
  });

  const getRaw: ToolDefinition = {
    name: "bls_get_raw",
    title: "Get raw series",
    description:
      "Return the unprocessed BLS Public Data API response for one or more timeseries ids — the escape hatch for exact series. Any BLS id works: the ones bls_get_indicator builds (LAUS, CES State & Area, OEWS, CPI, JOLTS, PPI) and others such as national CES (CEU2000000003) and CPS (LNU04000000). Take ids from a prior bls_get_indicator result's source block. The text reply is a compact table, one block per series, up to about 24,000 characters; the full response is always in structuredContent. For long spans, ask for fewer series per call.",
    input: z.object({
      ids: z
        .array(z.string())
        .min(1)
        .describe("BLS timeseries ids, e.g. ['LAUCN080310000000003']."),
      startYear: z.number().int().optional().describe("First year (optional)."),
      endYear: z.number().int().optional().describe("Last year (optional)."),
    }),
    examples: [{ title: "raw Denver County rate", input: { ids: ["LAUCN080310000000003"] } }],
    renderData: renderBlsRaw,
    textBudget: RAW_TEXT_BUDGET,
    handler: async (args): Promise<ToolHandlerResult> => {
      const rawInput = z.object({
        ids: z.array(z.string()).min(1),
        startYear: z.number().int().optional(),
        endYear: z.number().int().optional(),
      });
      const q = rawInput.parse(args);
      const bad = q.ids.filter((id) => !isBlsTimeseriesId(id));
      if (bad.length > 0) {
        throw new Error(
          `not BLS timeseries ids: ${bad.join(", ")}. A BLS id is a two-letter survey prefix followed by capitals and digits (e.g. LNU04000000, CEU2000000003); take ids from a bls_get_indicator result's source block or from BLS's series lookup.`,
        );
      }
      const responses = await fetchSeriesRaw(options.httpClient(), q.ids, {
        ...(q.startYear === undefined ? {} : { startYear: q.startYear }),
        ...(q.endYear === undefined ? {} : { endYear: q.endYear }),
        ...(options.apiKey?.() ? { apiKey: options.apiKey() as string } : {}),
      });
      return {
        data: { ids: q.ids, responses },
        source: {
          ...SOURCE,
          ids: q.ids,
          citation: buildCitation(
            { agency: "bls", program: "timeseries", ids: q.ids, url: SOURCE.url },
            now(),
          ),
        },
      };
    },
  };

  return [...generic, getRaw];
}

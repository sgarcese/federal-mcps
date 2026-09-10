import {
  buildCitation,
  footnoteFlagsFromCode,
  type Footnote,
  type GeographyCatalog,
  type HttpClient,
  type PlaceCandidate,
  placeRef,
  resolvePlace,
  type ToolDefinition,
  type ToolHandlerResult,
} from "@federal-mcps/core";
import { z } from "zod";
import { BLS_TIMESERIES_ENDPOINT } from "./describe-source.js";
import { lausCodeOf, lausCountyLookup } from "./laus-indicators.js";
import { isLausSeriesId } from "./laus.js";
import { blsIndicatorDefinitions } from "./indicators.js";
import { createIndicatorRegistry, type IndicatorDefinition } from "./registry.js";
import { fetchSeriesObservations, fetchSeriesRaw, type SeriesObservation } from "./series-fetch.js";

export interface BlsIndicatorToolsOptions {
  /** How the handler gets a read-only catalog (cached upstream). */
  catalog: () => GeographyCatalog;
  /** The core HTTP client for the BLS API (retry/budget/cache/fixtures). */
  httpClient: () => HttpClient;
  /** The BLS registration key, when configured (production only). */
  apiKey?: () => string | undefined;
  /** Injectable clock for the retrieval date and default period. */
  now?: () => Date;
}

const SOURCE = {
  agency: "bls",
  program: "LAUS",
  url: BLS_TIMESERIES_ENDPOINT,
};

/** Dedupe the footnote codes across a series' observations into structured Footnotes. */
function collectFootnotes(observations: readonly SeriesObservation[]): Footnote[] {
  const byCode = new Map<string, Footnote>();
  for (const obs of observations) {
    for (const f of obs.footnotes) {
      if (!byCode.has(f.code)) {
        byCode.set(f.code, { code: f.code, text: f.text, flags: footnoteFlagsFromCode(f.code) });
      }
    }
  }
  return [...byCode.values()];
}

/**
 * Resolve one place for an indicator to the agency code its series is built from — the shared
 * step behind `bls_compare_places` (and mirroring `bls_get_indicator`). Applies the program's
 * below-coverage fallback (e.g. LAUS city → county), so an `ok` result may carry a caveat. Never
 * fabricates: an ambiguous, unmatched or uncovered place is reported as such, not silently coerced.
 */
type SeriesResolution =
  | { status: "ok"; place: PlaceCandidate; code: string; caveat?: string }
  | { status: "ambiguous"; explanation: string; candidates: PlaceCandidate[] }
  | { status: "not_found" }
  | { status: "unavailable"; place: PlaceCandidate };

function resolveSeries(
  catalog: GeographyCatalog,
  def: IndicatorDefinition,
  name: string,
  opts: { kind?: string; state?: string },
): SeriesResolution {
  const resolved = resolvePlace(catalog, name, {
    ...(opts.kind === undefined ? {} : { kind: opts.kind }),
    ...(opts.state === undefined ? {} : { state: opts.state }),
  });
  if (resolved.status === "ambiguous") {
    return {
      status: "ambiguous",
      explanation: resolved.explanation,
      candidates: resolved.candidates,
    };
  }
  const top = resolved.candidates[0];
  if (!top) return { status: "not_found" };
  let code = def.agencyCodeOf(top);
  let caveat: string | undefined;
  if (!code && def.fallback) {
    const fb = def.fallback(catalog, top);
    if (fb) {
      code = fb.code;
      caveat = fb.caveat;
    }
  }
  if (!code) return { status: "unavailable", place: top };
  return caveat === undefined
    ? { status: "ok", place: top, code }
    : { status: "ok", place: top, code, caveat };
}

/**
 * `bls_get_indicator`: resolve a place, look the indicator up in the program registry (ADR-010 §1),
 * build its series id, fetch the observations, and return the shared provenance envelope with the
 * value(s), footnote flags, the resolved place and a citation (ADR-009 §5–§7). A city below the
 * LAUS 25,000 threshold falls back to its county with an explicit caveat — never a silent
 * substitution or a fabricated city number.
 */
export function blsIndicatorTools(options: BlsIndicatorToolsOptions): ToolDefinition[] {
  const now = options.now ?? (() => new Date());
  const registry = createIndicatorRegistry(blsIndicatorDefinitions);
  const input = z.object({
    place: z.string().describe("A place name, e.g. 'Denver', 'Denver County', 'Cook County IL'."),
    indicator: z
      .enum(registry.names() as [string, ...string[]])
      .default("unemployment_rate")
      .describe("Which indicator to return; see bls_list_indicators for the vocabulary."),
    kind: z
      .string()
      .optional()
      .describe("Restrict the place to a kind: 'county', 'city', 'metro', 'state'."),
    state: z.string().optional().describe("Restrict to a state: 2-letter USPS code or FIPS."),
    startYear: z
      .number()
      .int()
      .optional()
      .describe("First year (default: the prior calendar year)."),
    endYear: z
      .number()
      .int()
      .optional()
      .describe("Last year (default: the current calendar year)."),
    seasonallyAdjusted: z
      .boolean()
      .optional()
      .describe("Seasonally adjusted (default false; only states and a few metros publish it)."),
  });

  const handler = async (args: unknown): Promise<ToolHandlerResult> => {
    const p = input.parse(args);
    const catalog = options.catalog();
    const measure = p.indicator;
    // The enum guarantees a registered indicator, but guard so the type narrows.
    const def = registry.get(measure);
    if (!def) throw new Error(`unknown indicator "${measure}".`);
    const sourceBase = { agency: "bls", program: def.program, url: BLS_TIMESERIES_ENDPOINT };

    const resolved = resolvePlace(catalog, p.place, {
      ...(p.kind === undefined ? {} : { kind: p.kind }),
      ...(p.state === undefined ? {} : { state: p.state }),
    });

    if (resolved.status === "ambiguous") {
      return {
        data: { status: "ambiguous", candidates: resolved.candidates },
        source: { ...sourceBase, ids: [], citation: "" },
        limitations: [resolved.explanation],
      };
    }
    const top = resolved.candidates[0];
    if (!top) {
      return {
        data: { status: "not_found", query: p.place },
        source: { ...sourceBase, ids: [], citation: "" },
        limitations: [`No place matched "${p.place}".`],
      };
    }

    // The place we report and the agency code to fetch — a fallback substitute (e.g. the county on
    // a below-threshold LAUS city) when the resolved place has no direct series.
    let reportedGeoid = top.geoid;
    let reportedSumlevel = top.kind.sumlevel;
    let reportedName = top.name;
    let reportedParents = top.parents;
    let agencyCode = def.agencyCodeOf(top);
    let fallbackCaveat: string | undefined;

    if (!agencyCode && def.fallback) {
      const fb = def.fallback(catalog, top);
      if (fb) {
        reportedGeoid = fb.geoid;
        reportedSumlevel = fb.sumlevel;
        reportedName = fb.name;
        reportedParents = [];
        agencyCode = fb.code;
        fallbackCaveat = fb.caveat;
      }
    }

    if (!agencyCode) {
      return {
        data: { status: "unavailable", measure },
        source: { ...sourceBase, ids: [], citation: "" },
        place: placeRef({
          geoid: top.geoid,
          sumlevel: top.kind.sumlevel,
          label: top.kind.label,
          name: top.name,
        }),
        limitations: [
          `${def.program} publishes no series for ${top.name} and no fallback was found.`,
        ],
      };
    }

    const currentYear = now().getFullYear();
    const startYear = p.startYear ?? currentYear - 1;
    const endYear = p.endYear ?? currentYear;
    const seasonallyAdjusted = p.seasonallyAdjusted ?? def.defaultSeasonallyAdjusted;
    const seriesId = def.buildSeriesId(agencyCode, { seasonallyAdjusted });

    const [series] = await fetchSeriesObservations(options.httpClient(), [seriesId], {
      startYear,
      endYear,
      ...(options.apiKey?.() ? { apiKey: options.apiKey() as string } : {}),
    });
    const observations = series?.observations ?? [];
    const latest = observations[0];
    const footnotes = collectFootnotes(observations);
    const citation = buildCitation(
      { agency: "bls", program: def.program, ids: [seriesId], url: sourceBase.url },
      now(),
    );

    return {
      data: {
        measure,
        seasonallyAdjusted,
        latest: latest ? { period: `${latest.year}-${latest.period}`, value: latest.value } : null,
        observations,
      },
      source: { ...sourceBase, ids: [seriesId], citation },
      place: placeRef({
        geoid: reportedGeoid,
        sumlevel: reportedSumlevel,
        label: top.kind.label,
        name: reportedName,
        parents: reportedParents.map((pp) =>
          placeRef({
            geoid: pp.geoid,
            sumlevel: pp.kind.sumlevel,
            label: pp.kind.label,
            name: pp.name,
          }),
        ),
      }),
      ...(footnotes.length > 0 ? { footnotes } : {}),
      ...(latest ? { vintage: `${latest.year}-${latest.period}` } : {}),
      ...(fallbackCaveat ? { limitations: [fallbackCaveat] } : {}),
    };
  };

  return [
    {
      name: "bls_get_indicator",
      description:
        "Get a BLS Local Area Unemployment Statistics value for a place: unemployment rate, unemployment, employment, or labor force, with footnote flags and a citation. A city below the 25,000 LAUS threshold returns its county's value, flagged.",
      input,
      examples: [
        {
          title: "Denver County unemployment rate",
          input: { place: "Denver", kind: "county", indicator: "unemployment_rate" },
        },
      ],
      handler,
    },
    {
      name: "bls_compare_places",
      description:
        "Compare one indicator across several places, aligned on the latest period they all share. Each place is resolved and labelled; a place below coverage (e.g. a small city on LAUS) is flagged with its fallback, and an ambiguous or unmatched place is reported in its row rather than dropped.",
      input: z.object({
        indicator: z
          .enum(registry.names() as [string, ...string[]])
          .default("unemployment_rate")
          .describe("Which indicator to compare; see bls_list_indicators for the vocabulary."),
        places: z
          .array(z.string())
          .min(2)
          .max(20)
          .describe("The places to compare, e.g. ['Colorado', 'Utah', 'Nevada']. 2 to 20."),
        kind: z
          .string()
          .optional()
          .describe("Restrict every place to a kind: 'county', 'city', 'metro', 'state'."),
        state: z.string().optional().describe("Restrict to a state: 2-letter USPS code or FIPS."),
        startYear: z.number().int().optional().describe("First year (default: the prior year)."),
        endYear: z.number().int().optional().describe("Last year (default: the current year)."),
        seasonallyAdjusted: z
          .boolean()
          .optional()
          .describe(
            "Seasonally adjusted (default false; only states and a few metros publish it).",
          ),
      }),
      examples: [
        {
          title: "Compare unemployment across three states",
          input: { indicator: "unemployment_rate", places: ["Colorado", "Utah", "Nevada"] },
        },
      ],
      handler: async (args): Promise<ToolHandlerResult> => {
        const compareInput = z.object({
          indicator: z.enum(registry.names() as [string, ...string[]]).default("unemployment_rate"),
          places: z.array(z.string()).min(2).max(20),
          kind: z.string().optional(),
          state: z.string().optional(),
          startYear: z.number().int().optional(),
          endYear: z.number().int().optional(),
          seasonallyAdjusted: z.boolean().optional(),
        });
        const p = compareInput.parse(args);
        const catalog = options.catalog();
        const def = registry.get(p.indicator);
        if (!def) throw new Error(`unknown indicator "${p.indicator}".`);
        const sourceBase = { agency: "bls", program: def.program, url: BLS_TIMESERIES_ENDPOINT };
        const seasonallyAdjusted = p.seasonallyAdjusted ?? def.defaultSeasonallyAdjusted;

        // Resolve each place, then build a series id for the ones that have coverage.
        const resolutions = p.places.map((name) => ({
          name,
          resolution: resolveSeries(catalog, def, name, {
            ...(p.kind === undefined ? {} : { kind: p.kind }),
            ...(p.state === undefined ? {} : { state: p.state }),
          }),
        }));
        const seriesIdByName = new Map<string, string>();
        for (const { name, resolution } of resolutions) {
          if (resolution.status === "ok") {
            seriesIdByName.set(name, def.buildSeriesId(resolution.code, { seasonallyAdjusted }));
          }
        }
        const ids = [...new Set(seriesIdByName.values())];

        const currentYear = now().getFullYear();
        const series = ids.length
          ? await fetchSeriesObservations(options.httpClient(), ids, {
              startYear: p.startYear ?? currentYear - 1,
              endYear: p.endYear ?? currentYear,
              ...(options.apiKey?.() ? { apiKey: options.apiKey() as string } : {}),
            })
          : [];
        const byId = new Map(series.map((s) => [s.seriesId, s]));

        // Align on the latest period every series with data shares.
        const periodKey = (o: SeriesObservation) => `${o.year}-${o.period}`;
        const withData = series.filter((s) => s.observations.length > 0);
        let alignedPeriod: string | null = null;
        if (withData.length > 0) {
          const sets = withData.map((s) => new Set(s.observations.map(periodKey)));
          const [first, ...rest] = sets;
          const common = [...(first ?? [])].filter((k) => rest.every((set) => set.has(k)));
          alignedPeriod = common.length > 0 ? (common.sort().at(-1) ?? null) : null;
        }

        const rows = resolutions.map(({ name, resolution }) => {
          if (resolution.status === "ambiguous") {
            return {
              query: name,
              status: "ambiguous" as const,
              value: null,
              candidates: resolution.candidates.slice(0, 5).map((c) => ({
                name: c.name,
                geoid: c.geoid,
                kind: c.kind.label,
              })),
            };
          }
          if (resolution.status === "not_found") {
            return { query: name, status: "not_found" as const, value: null };
          }
          if (resolution.status === "unavailable") {
            return {
              query: name,
              status: "unavailable" as const,
              value: null,
              place: placeRef({
                geoid: resolution.place.geoid,
                sumlevel: resolution.place.kind.sumlevel,
                label: resolution.place.kind.label,
                name: resolution.place.name,
              }),
            };
          }
          const id = seriesIdByName.get(name);
          const obs = alignedPeriod
            ? byId.get(id ?? "")?.observations.find((o) => periodKey(o) === alignedPeriod)
            : undefined;
          return {
            query: name,
            status: (resolution.caveat ? "fallback" : "ok") as "ok" | "fallback",
            seriesId: id,
            period: obs ? periodKey(obs) : null,
            value: obs?.value ?? null,
            place: placeRef({
              geoid: resolution.place.geoid,
              sumlevel: resolution.place.kind.sumlevel,
              label: resolution.place.kind.label,
              name: resolution.place.name,
            }),
            ...(resolution.caveat ? { caveat: resolution.caveat } : {}),
          };
        });

        const footnotes = collectFootnotes(series.flatMap((s) => s.observations));
        return {
          data: { indicator: p.indicator, seasonallyAdjusted, period: alignedPeriod, rows },
          source: {
            ...sourceBase,
            ids,
            citation:
              ids.length > 0
                ? buildCitation(
                    { agency: "bls", program: def.program, ids, url: sourceBase.url },
                    now(),
                  )
                : "",
          },
          ...(footnotes.length > 0 ? { footnotes } : {}),
        };
      },
    },
    {
      name: "bls_list_indicators",
      description:
        "List the BLS indicators available (unemployment rate, unemployment, employment, labor force); given a place, also report whether the program publishes at that place's level or falls back to its county.",
      input: z.object({
        place: z
          .string()
          .optional()
          .describe("A place name to report availability for (optional)."),
        kind: z
          .string()
          .optional()
          .describe("Restrict the place to a kind: 'county', 'city', 'metro', 'state'."),
        state: z.string().optional().describe("Restrict to a state: 2-letter USPS code or FIPS."),
      }),
      examples: [
        { title: "indicators for Denver County", input: { place: "Denver", kind: "county" } },
      ],
      handler: async (args): Promise<ToolHandlerResult> => {
        const listInput = z.object({
          place: z.string().optional(),
          kind: z.string().optional(),
          state: z.string().optional(),
        });
        const q = listInput.parse(args);
        const indicators = registry.list().map((def) => ({
          indicator: def.name,
          description: def.description,
        }));
        const baseSource = { ...SOURCE, ids: [], citation: "" };
        if (!q.place) return { data: { indicators }, source: baseSource };

        const resolved = resolvePlace(options.catalog(), q.place, {
          ...(q.kind === undefined ? {} : { kind: q.kind }),
          ...(q.state === undefined ? {} : { state: q.state }),
        });
        if (resolved.status === "ambiguous") {
          return {
            data: { indicators, status: "ambiguous", candidates: resolved.candidates },
            source: baseSource,
            limitations: [resolved.explanation],
          };
        }
        const top = resolved.candidates[0];
        if (!top)
          return { data: { indicators, status: "not_found", query: q.place }, source: baseSource };
        const hasOwnCode = lausCodeOf(top) !== undefined;
        const county = hasOwnCode ? undefined : lausCountyLookup(options.catalog(), top);
        return {
          data: {
            indicators,
            publishedAtLevel: hasOwnCode,
            ...(county ? { fallback: { level: "county", name: county.name } } : {}),
          },
          source: baseSource,
          place: placeRef({
            geoid: top.geoid,
            sumlevel: top.kind.sumlevel,
            label: top.kind.label,
            name: top.name,
          }),
          ...(county
            ? {
                limitations: [
                  `${top.name} has no LAUS series; values fall back to ${county.name}.`,
                ],
              }
            : {}),
        };
      },
    },
    {
      name: "bls_get_raw",
      description:
        "Return the unprocessed BLS API response for one or more LAUS series ids — the escape hatch for exact series (build ids via resolve_place + the indicator, or list them from a prior result).",
      input: z.object({
        ids: z.array(z.string()).min(1).describe("LAUS series ids, e.g. ['LAUCN080310000000003']."),
        startYear: z.number().int().optional().describe("First year (optional)."),
        endYear: z.number().int().optional().describe("Last year (optional)."),
      }),
      examples: [{ title: "raw Denver County rate", input: { ids: ["LAUCN080310000000003"] } }],
      handler: async (args): Promise<ToolHandlerResult> => {
        const rawInput = z.object({
          ids: z.array(z.string()).min(1),
          startYear: z.number().int().optional(),
          endYear: z.number().int().optional(),
        });
        const q = rawInput.parse(args);
        const bad = q.ids.filter((id) => !isLausSeriesId(id));
        if (bad.length > 0) {
          throw new Error(
            `not LAUS series ids: ${bad.join(", ")}. Build them from resolve_place + the indicator.`,
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
              { agency: "bls", program: "LAUS", ids: q.ids, url: SOURCE.url },
              now(),
            ),
          },
        };
      },
    },
  ];
}

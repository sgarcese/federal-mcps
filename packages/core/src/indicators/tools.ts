import { z } from "zod";
import {
  buildCitation,
  type Footnote,
  footnoteFlagsFromCode,
  placeRef,
} from "../envelope/index.js";
import { type GeographyCatalog, type PlaceCandidate, resolvePlace } from "../geography/index.js";
import type { HttpClient } from "../http/index.js";
import type { ToolDefinition, ToolExample, ToolHandlerResult } from "../server/definition.js";
import type { SeriesObservation } from "./observations.js";
import {
  createIndicatorRegistry,
  DIMENSION_ARGUMENTS,
  type DimensionArgument,
  type DimensionSelection,
  fetchStrategyOf,
  type IndicatorDefinition,
  type IndicatorFetch,
  resolveDimensions,
} from "./registry.js";

export interface IndicatorToolsOptions {
  /** Agency prefix for the tool names (`bls`, `census`). */
  agency: string;
  /** The indicator definitions to register. */
  definitions: readonly IndicatorDefinition[];
  /** How the handler gets a read-only catalog (cached upstream). */
  catalog: () => GeographyCatalog;
  /** The core HTTP client for the agency API (retry/budget/cache/fixtures). */
  httpClient: () => HttpClient;
  /** The agency registration key, when configured (production only). */
  apiKey?: () => string | undefined;
  /** Injectable clock for the retrieval date and default period. */
  now?: () => Date;
  /** The fetch capability a definition uses when it declares none (e.g. BLS's timeseries fetch). */
  defaultFetch: IndicatorFetch;
  /** The agency API URL the envelope's source block cites. */
  sourceUrl: string;
  /** The program name the list tool's source block carries (cosmetic; default "indicators"). */
  sourceProgram?: string;
  /** The indicator the schema defaults to (default: the first definition). */
  defaultIndicator?: string;
  /** Tool descriptions — agency-specific prose, the model chooses tools by it. */
  descriptions: { getIndicator: string; comparePlaces: string; listIndicators: string };
  /** Worked examples the contract harness runs (at least one per tool). */
  examples: {
    getIndicator: readonly [ToolExample, ...ToolExample[]];
    comparePlaces: readonly [ToolExample, ...ToolExample[]];
    listIndicators: readonly [ToolExample, ...ToolExample[]];
  };
  /** Per-argument description overrides for the four picker arguments. */
  dimensionDescriptions?: Partial<Record<DimensionArgument, string>>;
}

/** The four named picker arguments every data tool accepts (ADR-013 §1); validated per indicator. */
function dimensionArgumentSchema(
  agency: string,
  overrides: Partial<Record<DimensionArgument, string>> | undefined,
) {
  const generic: Record<DimensionArgument, string> = {
    item: `An item code from the indicator's vocabulary (${agency}_list_indicators).`,
    industry: `An industry code from the indicator's vocabulary (${agency}_list_indicators).`,
    ownership: `An ownership code from the indicator's vocabulary (${agency}_list_indicators).`,
    occupation: `An occupation code from the indicator's vocabulary (${agency}_list_indicators).`,
  };
  const out: Partial<Record<DimensionArgument, z.ZodOptional<z.ZodString>>> = {};
  for (const arg of DIMENSION_ARGUMENTS) {
    out[arg] = z
      .string()
      .optional()
      .describe(overrides?.[arg] ?? generic[arg]);
  }
  return out as Record<DimensionArgument, z.ZodOptional<z.ZodString>>;
}

/** Parsed tool input may carry the four picker arguments, each possibly undefined. */
type DimensionArgs = Partial<Record<DimensionArgument, string | undefined>>;

/** Pull the picker arguments out of parsed tool input. */
function pickDimensionArgs(p: DimensionArgs): DimensionSelection {
  return {
    ...(p.item === undefined ? {} : { item: p.item }),
    ...(p.industry === undefined ? {} : { industry: p.industry }),
    ...(p.ownership === undefined ? {} : { ownership: p.ownership }),
    ...(p.occupation === undefined ? {} : { occupation: p.occupation }),
  };
}

/** Resolve an indicator's dimensions from tool input, or throw the actionable rejection. */
function dimensionsOrThrow(def: IndicatorDefinition, p: DimensionArgs): DimensionSelection {
  const r = resolveDimensions(def, pickDimensionArgs(p));
  if (!r.ok) throw new Error(r.message);
  return r.selection;
}

/** What `bls_list_indicators` publishes for an indicator's dimensions. */
function describeDimensions(def: IndicatorDefinition) {
  return def.dimensions === undefined
    ? {}
    : {
        dimensions: def.dimensions.map((d) => ({
          argument: d.argument,
          description: d.description,
          default: d.default,
          vocabulary: d.vocabulary.map((v) => ({ code: v.code, label: v.label })),
        })),
      };
}

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
  let caveat: string | undefined = code ? def.caveatOf?.(top) : undefined;
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
/** A UCGID-free reference to the nation, for national-scope answers (ADR-013 §7). */
const UNITED_STATES = { geoid: "US", sumlevel: "010", label: "nation", name: "United States" };

/** The name a caveat should use for a place a national-scope caller mentioned, without stopping on ambiguity. */
function mentionedPlaceName(
  catalog: GeographyCatalog,
  place: string,
  opts: { kind?: string | undefined; state?: string | undefined },
): string {
  const resolved = resolvePlace(catalog, place, {
    ...(opts.kind === undefined ? {} : { kind: opts.kind }),
    ...(opts.state === undefined ? {} : { state: opts.state }),
  });
  const top = resolved.status === "ambiguous" ? undefined : resolved.candidates[0];
  return top?.name ?? place;
}

/**
 * The family's indicator tools — `<agency>_get_indicator`, `<agency>_compare_places` and
 * `<agency>_list_indicators` — over a set of `IndicatorDefinition`s (ADR-010 §1, ADR-011 §2,
 * ADR-013, ADR-014). Agency-neutral: the agency, source URL, default fetch capability, tool
 * descriptions and worked examples are options; every program-specific rule lives in the
 * definitions. `<agency>_get_raw` stays agency-specific (each API's raw grammar differs).
 */
export function indicatorTools(options: IndicatorToolsOptions): ToolDefinition[] {
  const now = options.now ?? (() => new Date());
  const agency = options.agency;
  const registry = createIndicatorRegistry(options.definitions);
  const defaultIndicator = options.defaultIndicator ?? options.definitions[0]?.name ?? "";
  const sourceUrl = options.sourceUrl;
  const SOURCE = { agency, program: options.sourceProgram ?? "indicators", url: sourceUrl };
  const dimensionArguments = dimensionArgumentSchema(agency, options.dimensionDescriptions);

  /**
   * A national-scope indicator (PPI): no geography to resolve. A mentioned place only names the
   * caveat — the answer is the national series, stated as such, never a fabricated local number.
   */
  const nationalIndicator = async (
    def: IndicatorDefinition,
    p: {
      place?: string | undefined;
      kind?: string | undefined;
      state?: string | undefined;
      startYear?: number | undefined;
      endYear?: number | undefined;
      seasonallyAdjusted?: boolean | undefined;
    },
    dimensions: DimensionSelection,
    catalog: GeographyCatalog,
  ): Promise<ToolHandlerResult> => {
    const sourceBase = { agency, program: def.program, url: sourceUrl };
    const currentYear = now().getFullYear();
    const seasonallyAdjusted = p.seasonallyAdjusted ?? def.defaultSeasonallyAdjusted;
    const seriesId = def.buildSeriesId(UNITED_STATES.geoid, { seasonallyAdjusted, dimensions });
    const [series] = await fetchStrategyOf(def, options.defaultFetch)(
      options.httpClient(),
      [seriesId],
      {
        startYear: p.startYear ?? currentYear - 1,
        endYear: p.endYear ?? currentYear,
        ...(options.apiKey?.() ? { apiKey: options.apiKey() as string } : {}),
      },
    );
    const observations = series?.observations ?? [];
    const latest = observations[0];
    const footnotes = collectFootnotes(observations);
    const limitations =
      p.place === undefined
        ? []
        : [
            `${def.program} is published nationally only; this is not a ${mentionedPlaceName(catalog, p.place, p)} figure.`,
          ];
    return {
      data: {
        measure: def.name,
        seasonallyAdjusted,
        ...(def.dimensions ? { dimensions } : {}),
        latest: latest ? { period: `${latest.year}-${latest.period}`, value: latest.value } : null,
        observations,
      },
      source: {
        ...sourceBase,
        ids: [seriesId],
        citation: buildCitation(
          { agency, program: def.program, ids: [seriesId], url: sourceBase.url },
          now(),
        ),
      },
      place: placeRef(UNITED_STATES),
      ...(footnotes.length > 0 ? { footnotes } : {}),
      ...(latest ? { vintage: `${latest.year}-${latest.period}` } : {}),
      ...(limitations.length > 0 ? { limitations } : {}),
    };
  };
  const input = z.object({
    place: z
      .string()
      .optional()
      .describe(
        "A place name, e.g. 'Denver', 'Denver County', 'Cook County IL'. Optional only for a national-scope indicator.",
      ),
    indicator: z
      .enum(registry.names() as [string, ...string[]])
      .default(defaultIndicator)
      .describe(`Which indicator to return; see ${agency}_list_indicators for the vocabulary.`),
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
    ...dimensionArguments,
  });

  const handler = async (args: unknown): Promise<ToolHandlerResult> => {
    const p = input.parse(args);
    const catalog = options.catalog();
    const measure = p.indicator;
    // The enum guarantees a registered indicator, but guard so the type narrows.
    const def = registry.get(measure);
    if (!def) throw new Error(`unknown indicator "${measure}".`);
    const dimensions = dimensionsOrThrow(def, p);
    const sourceBase = { agency, program: def.program, url: sourceUrl };

    if (def.scope === "national") {
      return nationalIndicator(def, p, dimensions, catalog);
    }
    if (p.place === undefined) {
      throw new Error(
        `place is required for ${measure}; only national-scope indicators answer without one.`,
      );
    }

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
    let fallbackCaveat: string | undefined = agencyCode ? def.caveatOf?.(top) : undefined;

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
    const seriesId = def.buildSeriesId(agencyCode, { seasonallyAdjusted, dimensions });

    const [series] = await fetchStrategyOf(def, options.defaultFetch)(
      options.httpClient(),
      [seriesId],
      {
        startYear,
        endYear,
        ...(options.apiKey?.() ? { apiKey: options.apiKey() as string } : {}),
      },
    );
    const observations = series?.observations ?? [];
    const latest = observations[0];
    const footnotes = collectFootnotes(observations);
    const citation = buildCitation(
      { agency, program: def.program, ids: [seriesId], url: sourceBase.url },
      now(),
    );

    return {
      data: {
        measure,
        seasonallyAdjusted,
        ...(def.dimensions ? { dimensions } : {}),
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
      name: `${agency}_get_indicator`,
      title: "Get indicator",
      description: options.descriptions.getIndicator,
      input,
      examples: options.examples.getIndicator,
      handler,
    },
    {
      name: `${agency}_compare_places`,
      title: "Compare places",
      description: options.descriptions.comparePlaces,
      input: z.object({
        indicator: z
          .enum(registry.names() as [string, ...string[]])
          .default(defaultIndicator)
          .describe(
            `Which indicator to compare; see ${agency}_list_indicators for the vocabulary.`,
          ),
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
        ...dimensionArguments,
      }),
      examples: options.examples.comparePlaces,
      handler: async (args): Promise<ToolHandlerResult> => {
        const compareInput = z.object({
          indicator: z.enum(registry.names() as [string, ...string[]]).default(defaultIndicator),
          places: z.array(z.string()).min(2).max(20),
          kind: z.string().optional(),
          state: z.string().optional(),
          startYear: z.number().int().optional(),
          endYear: z.number().int().optional(),
          seasonallyAdjusted: z.boolean().optional(),
          ...dimensionArguments,
        });
        const p = compareInput.parse(args);
        const catalog = options.catalog();
        const def = registry.get(p.indicator);
        if (!def) throw new Error(`unknown indicator "${p.indicator}".`);
        if (def.scope === "national") {
          throw new Error(
            `${p.indicator} is published nationally only, so there is nothing to compare across places; use ${agency}_get_indicator.`,
          );
        }
        const dimensions = dimensionsOrThrow(def, p);
        const sourceBase = { agency, program: def.program, url: sourceUrl };
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
            seriesIdByName.set(
              name,
              def.buildSeriesId(resolution.code, { seasonallyAdjusted, dimensions }),
            );
          }
        }
        const ids = [...new Set(seriesIdByName.values())];

        const currentYear = now().getFullYear();
        const series = ids.length
          ? await fetchStrategyOf(def, options.defaultFetch)(options.httpClient(), ids, {
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
          data: {
            indicator: p.indicator,
            seasonallyAdjusted,
            ...(def.dimensions ? { dimensions } : {}),
            period: alignedPeriod,
            rows,
          },
          source: {
            ...sourceBase,
            ids,
            citation:
              ids.length > 0
                ? buildCitation({ agency, program: def.program, ids, url: sourceBase.url }, now())
                : "",
          },
          ...(footnotes.length > 0 ? { footnotes } : {}),
        };
      },
    },
    {
      name: `${agency}_list_indicators`,
      title: "List indicators",
      description: options.descriptions.listIndicators,
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
      examples: options.examples.listIndicators,
      handler: async (args): Promise<ToolHandlerResult> => {
        const listInput = z.object({
          place: z.string().optional(),
          kind: z.string().optional(),
          state: z.string().optional(),
        });
        const q = listInput.parse(args);
        const catalog = options.catalog();
        const baseSource = { ...SOURCE, ids: [], citation: "" };
        const catalogEntry = (def: IndicatorDefinition) => ({
          indicator: def.name,
          program: def.program,
          description: def.description,
          ...(def.scope ? { scope: def.scope } : {}),
          ...describeDimensions(def),
        });
        if (!q.place) {
          return { data: { indicators: registry.list().map(catalogEntry) }, source: baseSource };
        }

        const resolved = resolvePlace(catalog, q.place, {
          ...(q.kind === undefined ? {} : { kind: q.kind }),
          ...(q.state === undefined ? {} : { state: q.state }),
        });
        if (resolved.status === "ambiguous") {
          return {
            data: {
              indicators: registry.list().map(catalogEntry),
              status: "ambiguous",
              candidates: resolved.candidates,
            },
            source: baseSource,
            limitations: [resolved.explanation],
          };
        }
        const top = resolved.candidates[0];
        if (!top) {
          return {
            data: {
              indicators: registry.list().map(catalogEntry),
              status: "not_found",
              query: q.place,
            },
            source: baseSource,
          };
        }
        // Per-indicator availability at this place, across every program (ADR-010 §7).
        const indicators = registry.list().map((def) => {
          const publishedAtLevel = def.agencyCodeOf(top) !== undefined;
          const fb = publishedAtLevel ? undefined : def.fallback?.(catalog, top);
          return {
            ...catalogEntry(def),
            publishedAtLevel,
            ...(fb ? { fallbackTo: fb.name } : {}),
          };
        });
        return {
          data: { indicators },
          source: baseSource,
          place: placeRef({
            geoid: top.geoid,
            sumlevel: top.kind.sumlevel,
            label: top.kind.label,
            name: top.name,
          }),
        };
      },
    },
  ];
}

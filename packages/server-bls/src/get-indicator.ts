import {
  buildCitation,
  footnoteFlagsFromCode,
  type Footnote,
  type GeographyCatalog,
  getContainment,
  type HttpClient,
  type PlaceCandidate,
  placeRef,
  resolvePlace,
  type ToolDefinition,
  type ToolHandlerResult,
  ucgidOf,
} from "@federal-mcps/core";
import { z } from "zod";
import { BLS_TIMESERIES_ENDPOINT } from "./describe-source.js";
import { fetchLausObservations, type LausObservation } from "./laus-fetch.js";
import { buildLausSeriesId, LAUS_MEASURES } from "./laus.js";

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

/** The LAUS `agency_code` (the 15-char la.area code) for a resolved place, if it has one. */
function lausCodeOf(place: {
  agencyCodes: { agency: string; program: string; code: string }[];
}): string | undefined {
  return place.agencyCodes.find((c) => c.agency === "bls" && c.program === "LAUS")?.code;
}

/** The county that contains `place` (for the below-threshold fallback), with its LAUS code. */
function countyFallback(
  catalog: GeographyCatalog,
  place: PlaceCandidate,
): { geoid: string; name: string; code: string } | undefined {
  const counties = getContainment(catalog, place.ucgid)
    .filter((e) => e.kind.sumlevel === "050")
    .sort((a, b) => b.share - a.share);
  for (const county of counties) {
    const code = catalog
      .agencyCodesOf(ucgidOf("050", county.geoid))
      .find((c) => c.agency === "bls" && c.program === "LAUS")?.code;
    if (code) return { geoid: county.geoid, name: county.name, code };
  }
  return undefined;
}

/** Dedupe the footnote codes across a series' observations into structured Footnotes. */
function collectFootnotes(observations: readonly LausObservation[]): Footnote[] {
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
 * `bls_get_indicator`: resolve a place, build its LAUS series id, fetch the observations, and
 * return the shared provenance envelope with the value(s), footnote flags, the resolved place
 * and a citation (ADR-009 §5–§7). A city below the LAUS 25,000 threshold falls back to its
 * county with an explicit caveat — never a silent substitution or a fabricated city number.
 */
export function blsIndicatorTools(options: BlsIndicatorToolsOptions): ToolDefinition[] {
  const now = options.now ?? (() => new Date());
  const input = z.object({
    place: z.string().describe("A place name, e.g. 'Denver', 'Denver County', 'Cook County IL'."),
    indicator: z
      .enum(LAUS_MEASURES as [string, ...string[]])
      .default("unemployment_rate")
      .describe("Which LAUS indicator: unemployment_rate, unemployment, employment, labor_force."),
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
    const measure = p.indicator as (typeof LAUS_MEASURES)[number];
    const resolved = resolvePlace(catalog, p.place, {
      ...(p.kind === undefined ? {} : { kind: p.kind }),
      ...(p.state === undefined ? {} : { state: p.state }),
    });

    if (resolved.status === "ambiguous") {
      return {
        data: { status: "ambiguous", candidates: resolved.candidates },
        source: { ...SOURCE, ids: [], citation: "" },
        limitations: [resolved.explanation],
      };
    }
    const top = resolved.candidates[0];
    if (!top) {
      return {
        data: { status: "not_found", query: p.place },
        source: { ...SOURCE, ids: [], citation: "" },
        limitations: [`No place matched "${p.place}".`],
      };
    }

    // The place we report and the LAUS code to fetch — the county on a below-threshold fallback.
    let reportedGeoid = top.geoid;
    let reportedSumlevel = top.kind.sumlevel;
    let reportedName = top.name;
    let reportedParents = top.parents;
    let lausCode = lausCodeOf(top);
    let fallbackCaveat: string | undefined;

    if (!lausCode && top.flags.includes("below_threshold")) {
      const county = countyFallback(catalog, top);
      if (county) {
        reportedGeoid = county.geoid;
        reportedSumlevel = "050";
        reportedName = county.name;
        reportedParents = [];
        lausCode = county.code;
        fallbackCaveat = `Covers ${county.name}, not just ${top.name}: ${top.name} is below the LAUS 25,000 city threshold, so no city-level series exists.`;
      }
    }

    if (!lausCode) {
      return {
        data: { status: "unavailable", measure },
        source: { ...SOURCE, ids: [], citation: "" },
        place: placeRef({
          geoid: top.geoid,
          sumlevel: top.kind.sumlevel,
          label: top.kind.label,
          name: top.name,
        }),
        limitations: [`LAUS publishes no series for ${top.name} and no fallback county was found.`],
      };
    }

    const currentYear = now().getFullYear();
    const startYear = p.startYear ?? currentYear - 1;
    const endYear = p.endYear ?? currentYear;
    const seasonallyAdjusted = p.seasonallyAdjusted ?? false;
    const seriesId = buildLausSeriesId(lausCode, measure, { seasonallyAdjusted });

    const [series] = await fetchLausObservations(options.httpClient(), [seriesId], {
      startYear,
      endYear,
      ...(options.apiKey?.() ? { apiKey: options.apiKey() as string } : {}),
    });
    const observations = series?.observations ?? [];
    const latest = observations[0];
    const footnotes = collectFootnotes(observations);
    const citation = buildCitation(
      { agency: "bls", program: "LAUS", ids: [seriesId], url: SOURCE.url },
      now(),
    );

    return {
      data: {
        measure,
        seasonallyAdjusted,
        latest: latest ? { period: `${latest.year}-${latest.period}`, value: latest.value } : null,
        observations,
      },
      source: { ...SOURCE, ids: [seriesId], citation },
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
  ];
}

import {
  type GeographyCatalog,
  geographyTools,
  type HttpClient,
  indicatorTools,
  type ServerDefinition,
} from "@federal-mcps/core";
import { BEA_API_ENDPOINT, BEA_REQUIRED_SENTENCE, describeSource } from "./describe-source.js";
import { beaGetRawTool } from "./get-raw.js";
import { beaIndicatorDefinitions } from "./indicators.js";
import { BEA_SERVER_VERSION } from "./version.js";

/**
 * Instructions passed to the SDK so hosts surface them to the model (ADR-019 §1, §10). The shell
 * (#258) resolves places and describes the source; the indicator families extend this text.
 */
export const BEA_INSTRUCTIONS = `
This server gives U.S. Bureau of Economic Analysis Regional statistics organized by place:
personal income and per capita personal income, GDP and real GDP by industry, and regional price
parities. This release ships the shell only — \`bea_resolve_place\` and \`bea_describe_source\`;
the indicator tools follow. Resolve the place first with \`bea_resolve_place\`, and cite a result's
provenance block (source, release, retrieval date and a ready-to-paste citation) rather than a
bare number. ${BEA_REQUIRED_SENTENCE} All tools are read-only.
`.trim();

export interface BeaDefinitionDeps {
  catalog: GeographyCatalog;
  /** The core HTTP client for the BEA Data API (limiter, sanitize and error hooks; `index.ts`). */
  httpClient?: HttpClient;
  /** The BEA key (`BEA_API_KEY`), read lazily; sent as `queryAuth`, never logged or recorded. */
  apiKey?: () => string | undefined;
  /** Injectable clock (retrieval date, default years). */
  now?: () => Date;
}

/**
 * The indicator tools (`bea_get_indicator`, `bea_compare_places`, `bea_list_indicators`) over every
 * BEA family present (ADR-019 §2). Mounted once at least one family exists and a client is
 * configured; each definition brings its own fetch, so the default fetch refuses. Every citation
 * ends with BEA's required sentence (core `citationSuffix`).
 */
function beaIndicatorToolsFor(deps: BeaDefinitionDeps, catalog: () => GeographyCatalog) {
  const definitions = beaIndicatorDefinitions;
  const first = definitions[0];
  const httpClient = deps.httpClient;
  if (!first || !httpClient) return [];
  const tools = indicatorTools({
    agency: "bea",
    definitions,
    catalog,
    httpClient: () => httpClient,
    ...(deps.apiKey ? { apiKey: deps.apiKey } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    defaultFetch: async () => {
      throw new Error("every BEA indicator supplies its own fetch capability");
    },
    sourceUrl: BEA_API_ENDPOINT,
    citationSuffix: BEA_REQUIRED_SENTENCE,
    sourceProgram: "BEA Regional",
    defaultIndicator: first.name,
    descriptions: {
      getIndicator: `Get one BEA Regional indicator for a place with its year or quarter, caveats and citation (${definitions.map((d) => d.name).join(", ")}). ${BEA_REQUIRED_SENTENCE}`,
      comparePlaces:
        "Compare one BEA Regional indicator across several places in one upstream call; each row carries the value and its caveats, and a place BEA does not publish is reported in its row rather than dropped.",
      listIndicators:
        "List every BEA Regional indicator this server reports with its description and vocabularies; given a place, whether each is published at that place's level.",
    },
    examples: {
      getIndicator: [
        {
          title: `St. Joseph County, IN: ${first.name}`,
          input: { place: "St. Joseph County", state: "IN", kind: "county", indicator: first.name },
        },
      ],
      comparePlaces: [
        {
          title: `${first.name}: St. Joseph County vs Cook County`,
          input: { indicator: first.name, places: ["St. Joseph County, IN", "Cook County, IL"] },
        },
      ],
      listIndicators: [{ title: "Everything BEA Regional reports", input: {} }],
    },
  });
  return [
    ...tools,
    beaGetRawTool({
      httpClient: () => httpClient,
      apiKey: deps.apiKey ?? (() => undefined),
      ...(deps.now ? { now: deps.now } : {}),
    }),
  ];
}

/** The BEA server's definition: the shared resolver as `bea_resolve_place`, and the indicator tools. */
export function buildBeaDefinition(deps: BeaDefinitionDeps): ServerDefinition {
  const catalog = () => deps.catalog;
  return {
    name: "federal-mcps-bea",
    version: BEA_SERVER_VERSION,
    agency: "bea",
    instructions: BEA_INSTRUCTIONS,
    tools: [
      ...geographyTools({ agency: "bea", catalog, include: ["resolve_place"] }),
      ...beaIndicatorToolsFor(deps, catalog),
    ],
    describeSource,
  };
}

import {
  type GeographyCatalog,
  geographyTools,
  type HttpClient,
  indicatorTools,
  type ServerDefinition,
} from "@federal-mcps/core";
import {
  describeSource,
  HUD_USER_API_ENDPOINT,
  HUD_USER_REQUIRED_SENTENCE,
} from "./describe-source.js";
import { hudIndicatorDefinitions } from "./indicators.js";
import { HUD_SERVER_VERSION } from "./version.js";

/**
 * Instructions passed to the SDK so hosts surface them to the model (ADR-018 §1, §6). This
 * release ships the shell only — resolve a place, read the provenance block, no indicator
 * tools yet — so the guidance is short; later issues extend it per program.
 */
export const HUD_INSTRUCTIONS = `
This server gives HUD User Data API statistics organized by place: Fair Market Rents, Income
Limits and MTSP limits, Comprehensive Housing Affordability Strategy (CHAS) cost-burden
estimates, and the Picture of Subsidized Households. This release ships the shell only —
\`hud_resolve_place\` and \`hud_describe_source\` — every program is planned, not yet queryable;
\`hud_describe_source\` names each program's status. Resolve the place first with
\`hud_resolve_place\`, and once an indicator tool lands, cite the result's provenance block
(source, vintage, retrieval date and a ready-to-paste citation) rather than a bare number.
${HUD_USER_REQUIRED_SENTENCE} All tools are read-only.
`.trim();

export interface HudDefinitionDeps {
  catalog: GeographyCatalog;
  /**
   * The core HTTP client for the HUD User API, rate-limited per minute (ADR-018 §5). Optional
   * until the indicator tools land (#232+); the shell's tools make no upstream calls.
   */
  httpClient?: HttpClient;
  /** The HUD User bearer token (`HUD_USER_TOKEN`), read lazily; never logged or recorded. */
  token?: () => string | undefined;
  /** Injectable clock (retrieval date, default years). */
  now?: () => Date;
}

/**
 * The indicator tools (`hud_get_indicator`, `hud_compare_places`, `hud_list_indicators`) over
 * every HUD User family present (ADR-018 §1, §3). Mounted once at least one family exists and a
 * client is configured; each definition brings its own fetch, so the default fetch refuses.
 */
function hudIndicatorToolsFor(deps: HudDefinitionDeps, catalog: () => GeographyCatalog) {
  const definitions = hudIndicatorDefinitions;
  const first = definitions[0];
  const httpClient = deps.httpClient;
  if (!first || !httpClient) return [];
  const example = {
    place: "St. Joseph County",
    state: "IN",
    kind: "county",
    indicator: first.name,
  };
  return indicatorTools({
    agency: "hud",
    definitions,
    catalog,
    httpClient: () => httpClient,
    ...(deps.token ? { apiKey: deps.token } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    defaultFetch: async () => {
      throw new Error("every HUD User indicator supplies its own fetch capability");
    },
    sourceUrl: HUD_USER_API_ENDPOINT,
    sourceProgram: "HUD User",
    defaultIndicator: first.name,
    descriptions: {
      getIndicator: `Get one HUD User indicator for a place with its fiscal year or release period, caveats and citation (${definitions.map((d) => d.name).join(", ")}). ${HUD_USER_REQUIRED_SENTENCE}`,
      comparePlaces:
        "Compare one HUD User indicator across several places; each row carries the value and its caveats, and a place HUD does not publish is reported in its row rather than dropped.",
      listIndicators:
        "List every HUD User indicator this server reports with its description and vocabularies; given a place, whether each is published at that place's level.",
    },
    examples: {
      getIndicator: [{ title: `St. Joseph County, IN: ${first.name}`, input: example }],
      comparePlaces: [
        {
          title: `${first.name}: St. Joseph County vs Cook County`,
          input: { indicator: first.name, places: ["St. Joseph County, IN", "Cook County, IL"] },
        },
      ],
      listIndicators: [{ title: "Everything HUD User reports", input: {} }],
    },
  });
}

/** The HUD User server's definition: core's resolver mounted as `hud_resolve_place`. */
export function buildHudDefinition(deps: HudDefinitionDeps): ServerDefinition {
  const catalog = () => deps.catalog;
  return {
    name: "federal-mcps-hud",
    version: HUD_SERVER_VERSION,
    agency: "hud",
    instructions: HUD_INSTRUCTIONS,
    tools: [
      ...geographyTools({ agency: "hud", catalog, include: ["resolve_place"] }),
      ...hudIndicatorToolsFor(deps, catalog),
    ],
    describeSource,
  };
}

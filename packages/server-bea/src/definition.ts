import {
  type GeographyCatalog,
  geographyTools,
  type HttpClient,
  type ServerDefinition,
} from "@federal-mcps/core";
import { BEA_REQUIRED_SENTENCE, describeSource } from "./describe-source.js";
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

/** The BEA server's definition: the shared resolver as `bea_resolve_place`; indicators follow. */
export function buildBeaDefinition(deps: BeaDefinitionDeps): ServerDefinition {
  const catalog = () => deps.catalog;
  return {
    name: "federal-mcps-bea",
    version: BEA_SERVER_VERSION,
    agency: "bea",
    instructions: BEA_INSTRUCTIONS,
    tools: [...geographyTools({ agency: "bea", catalog, include: ["resolve_place"] })],
    describeSource,
  };
}

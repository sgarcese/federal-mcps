import {
  type GeographyCatalog,
  geographyTools,
  type HttpClient,
  type ServerDefinition,
} from "@federal-mcps/core";
import { CENSUS_API_REQUIRED_SENTENCE, describeSource } from "./describe-source.js";
import { CENSUS_SERVER_VERSION } from "./version.js";

/**
 * Instructions passed to the SDK so hosts surface them to the model (ADR-014). Written for the
 * Census analogues of the BLS judgment cases: which kind of place, the 65,000 rule, margins of
 * error, annotation values, and never a bare number.
 */
export const CENSUS_INSTRUCTIONS = `
This server gives U.S. Census Bureau statistics organized by place — American Community Survey
(ACS) estimates and decennial counts. Before answering, resolve which kind of place the user
means: a city, its county and its metro area are different geographies that overlap but do
not nest, and \`census_resolve_place\` returns status "ambiguous" when a name could mean
several — pick one with the \`kind\` argument rather than guessing. Resolve the place first,
then read a number.

Two rules shape every ACS answer. First, the ACS publishes 1-year estimates only for areas of
65,000 or more people; every smaller city, town or tract is answered from the 5-year product,
which covers a five-year period (for example 2020–2024) rather than one year. The answer names
the product and the period; never present a five-year figure as a single year's. Second, every
ACS value is an estimate with a margin of error at 90% confidence. The envelope carries the
margin and a reliability grade (high, medium, low); quote both for small places, and treat a
low-reliability estimate as indicative, not precise. Some cells carry Census annotation values
instead of numbers — insufficient sample, not applicable, or an estimate controlled to an
independent population count; they come back as null with the Census meaning, and you must
say so rather than fill the gap. Decennial counts have no margin of error but are 2020 values.

Indicator tools arrive with the Census milestone; for now this server resolves places and
describes its source. Every result carries a provenance block — the resolved place, the
dataset and vintage, the variable id, footnotes, the retrieval date and a ready-to-paste
citation. ${CENSUS_API_REQUIRED_SENTENCE} All tools are read-only.
`.trim();

export interface CensusDefinitionDeps {
  catalog: GeographyCatalog;
  /** The core HTTP client for the Census Data API. */
  httpClient: HttpClient;
  /** The Census Data API key (required for every data query, ADR-014 §9). */
  apiKey?: () => string | undefined;
  /** Injectable clock (retrieval date). */
  now?: () => Date;
}

/** The Census server's definition: core's resolver mounted as `census_resolve_place`. */
export function buildCensusDefinition(deps: CensusDefinitionDeps): ServerDefinition {
  const catalog = () => deps.catalog;
  return {
    name: "federal-mcps-census",
    version: CENSUS_SERVER_VERSION,
    agency: "census",
    instructions: CENSUS_INSTRUCTIONS,
    tools: [...geographyTools({ agency: "census", catalog, include: ["resolve_place"] })],
    describeSource,
  };
}

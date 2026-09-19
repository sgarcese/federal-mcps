import {
  type GeographyCatalog,
  geographyTools,
  type HttpClient,
  indicatorTools,
  type ServerDefinition,
} from "@federal-mcps/core";
import { acsFetch } from "./acs.js";
import {
  CENSUS_API_ENDPOINT,
  CENSUS_API_REQUIRED_SENTENCE,
  describeSource,
} from "./describe-source.js";
import { censusIndicatorDefinitions } from "./indicators.js";
import { censusGetRawTool } from "./get-raw.js";
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

\`census_get_indicator\` returns one indicator for a resolved place — population, median age,
median household and per capita income, poverty rate, unemployment rate (ACS), bachelor's or
higher, uninsured share, mean commute, median rent, median home value, owner-occupied share,
median housing cost, and the 2020 decennial count. The optional \`product\` argument picks
1-year or 5-year; by default the server chooses by population and says which it used.
\`census_compare_places\` compares one indicator across places; \`census_list_indicators\`
names every indicator and its vocabularies. Every result carries a provenance block — the resolved place, the
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
    tools: [
      ...geographyTools({ agency: "census", catalog, include: ["resolve_place"] }),
      ...indicatorTools({
        agency: "census",
        definitions: censusIndicatorDefinitions,
        catalog,
        httpClient: () => deps.httpClient,
        ...(deps.apiKey ? { apiKey: deps.apiKey } : {}),
        ...(deps.now ? { now: deps.now } : {}),
        defaultFetch: acsFetch,
        sourceUrl: CENSUS_API_ENDPOINT,
        sourceProgram: "ACS",
        defaultIndicator: "population",
        descriptions: {
          getIndicator:
            "Get one Census indicator for a place with its margin of error, reliability grade and citation: population, median age, median household income, per capita income, poverty rate, unemployment rate (ACS), bachelor's degree or higher, uninsured rate, mean commute, median gross rent, median home value, owner-occupied share, median housing cost (American Community Survey), and decennial_population (2020 count). The ACS product is chosen by population — 1-year at 65,000 or more, else 5-year — unless product is given; the answer always states which and why. Annotation values come back as null with the Census meaning, never a number.",
          comparePlaces:
            "Compare one Census indicator across several places on one vintage; each row carries the value, its margin of error and reliability grade, and an ambiguous or unmatched place is reported in its row rather than dropped. Places of mixed size should be compared on product 5-year.",
          listIndicators:
            "List every Census indicator this server reports (ACS headline estimates and the decennial count) with its description and the product vocabulary; given a place, whether each is published at that place's level.",
        },
        examples: {
          getIndicator: [
            {
              title: "Denver County median household income, 5-year",
              input: {
                place: "Denver",
                kind: "county",
                indicator: "median_household_income",
                product: "5-year",
              },
            },
          ],
          comparePlaces: [
            {
              title: "Median household income, Denver County vs Sedona, 5-year",
              input: {
                indicator: "median_household_income",
                places: ["Denver County", "Sedona"],
                product: "5-year",
              },
            },
          ],
          listIndicators: [
            { title: "indicators for Denver County", input: { place: "Denver", kind: "county" } },
          ],
        },
        dimensionDescriptions: {
          product: "Which ACS product: auto (default; by population), 1-year, or 5-year.",
        },
      }),
      censusGetRawTool({
        httpClient: () => deps.httpClient,
        ...(deps.apiKey ? { apiKey: deps.apiKey } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      }),
    ],
    describeSource,
  };
}

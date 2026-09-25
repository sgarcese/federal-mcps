import {
  type GeographyCatalog,
  geographyTools,
  type HttpClient,
  type ServerDefinition,
} from "@federal-mcps/core";
import { describeSource } from "./describe-source.js";
import { blsIndicatorTools } from "./get-indicator.js";
import { BLS_SERVER_VERSION } from "./version.js";

/**
 * Instructions passed to the SDK so hosts surface them to the model
 * (`ServerDefinition.instructions`, `createServer` in
 * `packages/core/src/server/create-server.ts`).
 *
 * Drafted from `docs/spikes/geography-catalog.md` ("The hierarchy the model
 * has to understand" and "Gotchas the build must handle") so the model asks
 * for the right geographic level before it asks for a number, and knows what
 * this server can and cannot answer (all seven BLS programs are live, with pickers; M7, ADR-013).
 */
export const BLS_INSTRUCTIONS = `
This server gives U.S. labor market and price statistics from the Bureau of Labor
Statistics (BLS), organized by place. Before answering, resolve which kind of place the
user means: only state, county, tract and block nest strictly. A city, a metro area (CBSA)
and the county it sits in are three different geographies that overlap but do not nest,
and BLS reports different things at each level. Denver is the worked example: the city
(place 0820000), Denver County (FIPS 08031) and the Denver-Aurora-Centennial metro (CBSA
19740) share territory but are not interchangeable. Confirm which level the user wants, or
state which one you used, rather than silently picking one.

BLS's Local Area Unemployment Statistics (LAUS) publishes a city-level series only for
incorporated places of 25,000 or more, plus New England towns — roughly 1,700 places. Every
smaller city, town or community has no city-level series; the correct answer is the
surrounding county's number, with a caveat that it covers the whole county. Never invent or
approximate a city-level number below the threshold. Likewise most places have no local
Consumer Price Index: CPI publishes for the U.S. city average, census regions and
divisions, and about 23 metro areas. Elsewhere, say so and offer the nearest published
geography instead of a local figure.

Start with \`bls_resolve_place\`, which turns a place name into candidates carrying every
identifier (GEOID, UCGID, Data Commons DCID), parents, which programs publish at its level,
BLS area codes, and structured flags — including \`below_threshold\` with its county as the
fallback. Resolve the place first, then read a number.

\`bls_get_indicator\` returns a statistic for a resolved place across seven programs:
unemployment, employment and labor force (LAUS); payroll employment (CES, state and metro);
occupational wage (OEWS, state and metro); the consumer price index (CPI); job openings,
hires, quits and layoffs (JOLTS, state); covered employment and average weekly wage (QCEW,
county, state and metro, from its own CSV feed: the latest quarter, or with years every
published period since 2014, five years of quarters at most); and the producer price
index (PPI, national only). Coverage fallbacks are always flagged, never fabricated: a
below-25,000 city reads its county; a place with no local CPI reads its census division,
then region, then the U.S. city average; a multi-state metro's CES series is filed under
its first state and the answer says so.

Five optional picker arguments narrow an indicator, each validated against a published
vocabulary: \`item\` (CPI expenditure groups such as food, housing, energy, gasoline; PPI
commodity indexes such as inputs to construction, lumber, steel, concrete), \`industry\` and
\`ownership\` (QCEW NAICS industry and ownership — construction is industry 23, and any 3- to
6-digit code works, e.g. 236; detail is published only by ownership, e.g. private),
\`frequency\` (QCEW quarterly or annual), and \`occupation\` (OEWS SOC major groups). \`bls_list_indicators\` names every indicator, its vocabularies, and whether its
program publishes at a place's level. Producer and construction-material prices are
national only: \`producer_price_index\` takes no place, and if one is given the answer is
still the national series, flagged as such — never a local number.

\`bls_compare_places\` compares one indicator (same pickers) across up to twenty places on
the latest period they share; \`bls_get_raw\` returns the unprocessed BLS response for exact
timeseries ids from any program; \`bls_describe_source\` reports each program's coverage.

Every result carries a provenance block: the resolved place, program and series id,
retrieval date, vintage, footnotes (including preliminary and revised flags), and a
ready-to-paste citation. Cite it when you report a number; never state a BLS figure without
it. All tools are read-only.
`.trim();

/**
 * The BLS server's definition (issue #8, on the shell from #6; #59 adds place
 * resolution; #82/#83 add the LAUS data tools). `bls_resolve_place` is mounted from the
 * shared resolver (`geographyTools`, ADR-003 §8, ADR-008) over the bundled catalog — the
 * BLS server ships no place lookup of its own, so the contract's no-own-resolve rule
 * stays green (the tool is `fromCore`); `bls_get_indicator`, `bls_list_indicators` and
 * `bls_get_raw` come from `blsIndicatorTools` (LAUS over the BLS timeseries API, ADR-009).
 */
export interface BlsDefinitionDeps {
  catalog: GeographyCatalog;
  /** The core HTTP client for the BLS API (bls_get_indicator, #82). */
  httpClient: HttpClient;
  /** The BLS registration key, when configured (production only). */
  apiKey?: () => string | undefined;
  /** Injectable clock (retrieval date, default period). */
  now?: () => Date;
}

export function buildBlsDefinition(deps: BlsDefinitionDeps): ServerDefinition {
  const catalog = () => deps.catalog;
  return {
    name: "federal-mcps-bls",
    version: BLS_SERVER_VERSION,
    agency: "bls",
    instructions: BLS_INSTRUCTIONS,
    tools: [
      ...geographyTools({ agency: "bls", catalog, include: ["resolve_place"] }),
      ...blsIndicatorTools({
        catalog,
        httpClient: () => deps.httpClient,
        ...(deps.apiKey ? { apiKey: deps.apiKey } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      }),
    ],
    describeSource,
  };
}

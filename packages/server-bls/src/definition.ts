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
 * this server can and cannot answer in M1.
 */
export const BLS_INSTRUCTIONS = `
This server gives U.S. labor market and price statistics from the Bureau of Labor
Statistics (BLS), organized by place. Before answering a question, resolve which kind
of place the user means: only state, county, tract and block are strictly nested inside
one another. A city, a metro area (CBSA) and the county it sits in are three different
geographies that overlap but do not nest, and BLS reports different things at each
level. Denver, Colorado is the worked example: the city of Denver (Census place
0820000), Denver County (FIPS 08031) and the Denver-Aurora-Centennial metro area (CBSA
19740) happen to share much of the same territory but are not interchangeable, and in
most of the country city and county boundaries diverge sharply. Always confirm which
level the user wants, or state which one you used, rather than silently picking one.

A critical coverage gap follows from this: BLS's Local Area Unemployment Statistics
(LAUS) program publishes a city-level unemployment series only for incorporated places
with a population of 25,000 or more, plus New England towns. That is roughly 1,700
places nationwide. For every smaller city, town or unincorporated community, there is no
city-level series at all; the correct answer is the surrounding county's numbers, with a
caveat that the number covers the whole county rather than just that place. Never invent
or approximate a city-level number for a place below the threshold.

Similarly, most cities have no local Consumer Price Index (CPI). CPI publishes for the
U.S. city average, for census regions and divisions, and for roughly 23 named
metropolitan areas — not for individual cities, counties or most metros. When a user
asks about local prices or inflation and their place is not one of those ~23 areas, say
so plainly and offer the nearest published geography (region, division, or U.S. city
average) instead of fabricating a local figure.

Start with \`bls_resolve_place\`, which turns a place name into candidates carrying every
identifier (GEOID, UCGID, Data Commons DCID), the place's parents, which BLS programs
publish at its level, its BLS area codes, and structured flags — including
\`below_threshold\` when a place is under the LAUS 25,000 cutoff, with its county as the
fallback. Resolve the place first, then read a number.

\`bls_get_indicator\` returns a statistic for a resolved place across five programs:
unemployment, employment and labor force (LAUS); payroll employment (CES); occupational
wage (OEWS); the all-items price index (CPI); and job openings, hires, quits and layoffs
(JOLTS). It applies each program's coverage fallback — a below-25,000 city reads its
county, a place with no local CPI reads the U.S. city average — always flagged, never
fabricated. CES and OEWS are state-level for now (metro series arriving); JOLTS is
state-level below national. \`bls_list_indicators\` names every indicator, its program, and
whether that program publishes at a place's level; \`bls_compare_places\` compares one
indicator across places, aligned on the latest period they share; \`bls_get_raw\` returns
the unprocessed BLS response for exact series ids. \`bls_describe_source\` reports each
program's coverage; the one program still planned is QCEW (employment and wages by
industry), on a separate feed. Call it when unsure what this server can answer.

Every result this server family returns — now and once data tools land — carries a
provenance block: the resolved place, the BLS program and series id, the retrieval date,
vintage, footnotes (including preliminary and revised flags), and a ready-to-paste
citation. Cite that citation when you report a number; never state a BLS figure without
it. All tools are read-only: this server only reads published federal statistics and
never writes or modifies anything.
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

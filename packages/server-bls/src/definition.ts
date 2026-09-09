import type { ServerDefinition } from "@federal-mcps/core";
import { describeSource } from "./describe-source.js";
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

This server (M1, this release) exposes only \`bls_describe_source\`, which reports what
this server covers today and what is planned: Local Area Unemployment Statistics (LAUS,
unemployment), Current Employment Statistics State & Area (CES S&A, payroll
employment), the Quarterly Census of Employment and Wages (QCEW, employment and wages by
industry), Occupational Employment and Wage Statistics (OEWS, wages by occupation), the
Consumer Price Index (CPI), and the Job Openings and Labor Turnover Survey (JOLTS).
Every one of them is listed as "planned" right now — data-fetching tools for
unemployment, payroll employment, wages, prices and job openings arrive in later
milestones. Call \`bls_describe_source\` first when you are unsure what this server can
answer, rather than assuming a tool exists.

Every result this server family returns — now and once data tools land — carries a
provenance block: the resolved place, the BLS program and series id, the retrieval date,
vintage, footnotes (including preliminary and revised flags), and a ready-to-paste
citation. Cite that citation when you report a number; never state a BLS figure without
it. All tools are read-only: this server only reads published federal statistics and
never writes or modifies anything.
`.trim();

/**
 * The BLS server's declarative definition (issue #8, on the shell from #6).
 * `tools: []` in M1: nothing but the auto-registered `bls_describe_source`
 * ships until M3 adds the first data tools (docs/architecture.md, "Release
 * 1: BLS only").
 */
export const definition: ServerDefinition = {
  name: "federal-mcps-bls",
  version: BLS_SERVER_VERSION,
  agency: "bls",
  instructions: BLS_INSTRUCTIONS,
  tools: [],
  describeSource,
};

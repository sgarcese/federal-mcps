# Proposal — what to build

*Plain language. September 2026.*

---

**Build a small, boring lookup service that tells an agent exactly how two pieces of American geography relate to each other — and refuses to let it guess.**

That's it. Not a knowledge graph, not a reasoning layer. A reference desk.

## Why this, and not the original idea

The original concept was a knowledge graph that would help an LLM relate geographies and give better-caveated answers — the right vintage, the right geography, the limits that make a finding defensible.

We measured it. Frontier models already do that, unprompted, at ceiling. Claude Opus scored 0.95 on exactly those items and 0.94 with no lookup tools at all. When we suspected the questions were telegraphing their own traps and rewrote them as flat requests with no cue, it still scored 8 out of 8.

Small models don't. Claude Haiku scored 0.58 on the same items and 0.44 on the de-cued version, raising the critical issue unprompted in only 3 of 8 cases. And it fails quietly — it told us Allston *is* ZIP 02134, asserted a ZCTA was wholly inside Suffolk County and explicitly denied the part that isn't, and produced "9.1%, 85,889 of 856,192" for a Connecticut county that stopped existing as a statistical geography in 2022.

Production agent loops run on cheap models. **That's the market: making cheap agents safe enough to do this work, not making good agents marginally better.**

## What it does — four things

**1. Translate between geographies, with the math attached.**
Not "does this ZIP fall in this county" but "ZIP 19104 covers 17 census tracts, and here's what share of its people live in each one." The share is the product. Nobody serves this today — the best tool in the country for it, MCDC's Geocorr, is a web form with no API, and its internals are explicitly not exposed.

**2. Track boundaries through time.**
"This 2010 tract became these three 2020 tracts." Today, asking the Census API for a retired tract returns an *empty response, not an error*. An agent looping over tracts silently drops the ones that changed and reports the rest as if nothing happened. We reproduced this directly (see `02-BENCHMARK-RESULTS.md`).

**3. Resolve the names people actually use.**
"South Philly," "Southie," "the Mission" → a specific list of tracts, tagged with whose definition it is and how confident you should be. Nobody owns this. The de facto national reference is a Zillow shapefile frozen in 2017 that federal agencies are still redistributing nine years later.

**4. Answer "can I even get this?"**
Which agency publishes this variable, at what geography, for what years. Cheapest thing to build; saves the most wasted agent turns.

## The design rule that matters most

**Every answer comes back as structured fields — value, source, vintage, and warnings as flags the calling code can check. Not prose.**

A small model will read a prose caveat and then contradict it two sentences later. We watched it happen: *"You cannot simply take the median of the five block group median values"* — immediately followed by a recipe for taking a population-weighted mean of the five medians.

A flag the orchestration layer can branch on survives that. A paragraph does not.

## What to leave out

- **No geometry or map rendering.** Not the problem.
- **No fetching the underlying data.** Other MCPs already do that well.
- **No advisory layer as prose.** Frontier models don't need it; small models ignore it. It belongs in the structured fields instead.
- **Don't market tract lineage as the headline.** `geosnap.harmonize()` does it in one function call, free, from a maintained 275-star package. You will lose that argument.

## Scope for v1

Boston and Philadelphia. One vintage pair. Four tools. A few months, not a year.

## How you'd know it worked

Run UGEO-Bench with a cheap model, with and without your server. Haiku currently sits at **0.545**. If your tool doesn't move that meaningfully, the tool is wrong — and you find out in a week rather than after six months of building.

## Two risks worth sitting with

**The Urban Institute already built the crosswalk half of this.** `UrbanInstitute/geocrosswalk` — `convert_geolevel()`, `harmonize_by_time()`, Geocorr + NHGIS + Census weights bundled. Eight stars, no forks, stalled, work moved elsewhere. Competent people at a serious institution shipped this exact spec and found no audience. **That's a demand problem, not a supply gap.** Find three people who will actually use this before building it.

**The Census Bureau's own MCP is one roadmap item from eating the crosswalk piece.** It's CC0, government-maintained, 81 stars, and already resolves geography FIPS. The neighborhood layer and the structured guardrails are the parts they won't ship.

## One suggestion

**Consider publishing the benchmark before the server.**

No one has measured agents on US statistical geography — every existing geospatial agent benchmark (GeoBenchX, GeoHaluBench, GeoAnalystBench) stops at country, city or POI level. Publishing costs almost nothing, establishes the category under your name, and tells you whether anyone cares before you commit six months.

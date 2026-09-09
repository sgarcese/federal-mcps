# Prior art review

Two independent sweeps: academic/open-source geospatial knowledge graphs, and shipped software (MCP servers, commercial platforms, libraries). Conducted August 2026.

**Verdict up front: nobody ships this, but the library ecosystem covers more of it than the original pitch assumed. The defensible product is considerably smaller than the original vision — and the part that survives is genuinely unowned.**

---

## 1. Is anyone shipping this? No.

Searched GitHub, Glama, mcpservers.org, PulseMCP, LobeHub, Composio, mcp.so and the Anthropic connector registry, with multiple phrasings (crosswalk, relationship file, allocation factor, areal interpolation, apportionment, vernacular geography).

- **Zero** MCP servers expose HUD-USPS crosswalks — [HUD publishes an API](https://www.huduser.gov/portal/dataset/uspszip-api.html) and nobody has wrapped it.
- **Zero** expose Census 2020↔2010 tract relationship files.
- **Zero** expose [NHGIS crosswalks](https://www.nhgis.org/geographic-crosswalks).
- **Zero** do neighborhood-name → boundary resolution.

| Server | Crosswalks / lineage? | Status |
|---|---|---|
| [Census Bureau official MCP](https://github.com/uscensusbureau/us-census-bureau-data-api-mcp) | **No** — FIPS/UCGID resolution only | 81★, CC0, v0.1.2-beta (Mar 2026). The incumbent |
| [open-census-mcp-server](https://github.com/brockwebb/open-census-mcp-server) | No — but has a "pragmatic rules layer" for MOE/fitness-for-use | ~20★, mid-rebuild |
| [census-geocoding-mcp](https://github.com/hesscl/census-geocoding-mcp) | No — Geocoder wrapper | 0★, v0.1 |
| [Composio census toolkit](https://composio.dev/toolkits/census_bureau) | No — 81 tools, all fetch/geocode | Commercial-hosted |
| [CARTO MCP](https://docs.carto.com/carto-for-agents/mcp-server.md) | No — BYO warehouse + your workflows | Oct 2025, enterprise |
| [Esri ArcGIS MCP (beta)](https://www.esri.com/arcgis-blog/products/platform/developers/mcp-support-beta-and-arcgis-static-maps-service-in-arcgis-location-platform-release) | No — geocode/route/elevation | Announced Jun 2026 |
| [Mapbox MCP](https://www.mapbox.com/blog/introducing-the-mapbox-model-context-protocol-mcp-server) | No administrative geography at all | Jul 2025 |

Commercially: Precisely sells address→boundary enrichment via API but ships no MCP; SafeGraph/Advan/Unacast/Placer are foot-traffic businesses. **Nobody sells "ask a question, get an exact geographic relation" as an agent-callable service.**

---

## 2. But the library ecosystem already covers most of it

The real competition isn't other MCPs — it's an agent with a sandbox and `pip install`.

| Library | Crosswalks + weights | Lineage | Status |
|---|---|---|---|
| [**geosnap**](https://github.com/oturns/geosnap) | Areal **and dasymetric** interpolation | `harmonize()` converts 1990/2000/2010 tracts → 2020 in one call | **275★, 1,183 commits, actively maintained** |
| [**tidycensus**](https://walker-data.com/tidycensus/reference/interpolate_pw.html) | `interpolate_pw()` — population-weighted | Enables it | Widely used; tigris updated May 2026 |
| [**zippeR**](https://cran.r-project.org/package=zippeR) | Wraps UDS ZIP→ZCTA **and HUD ZIP→census geography** | No | Pfizer OSS, vignette updated Jun 2026 |
| [**NHGIS crosswalks**](https://www.nhgis.org/geographic-crosswalks) | Yes — `wt_pop`, `wt_hu`, `wt_hh` | Yes | Free API w/ registration, institution-grade |
| [**MCDC Geocorr**](https://mcdc.missouri.edu/applications/geocorr.html) | **Yes — the canonical source**, any geography pair | Via vintage selection | ⚠️ **Web form only. No API.** |
| pygris | **No** (TIGER loading only — contrary to common assumption) | No | Maintained |

**A sandbox with geosnap + tidycensus + zippeR covers roughly 70–80% of the original scope.** Selling "2010→2020 lineage" as a differentiator against a maintained 275-star package is not credible.

---

## 3. The academic geo-KG track record is a graveyard

**[KnowWhereGraph](https://arxiv.org/html/2502.13874v1)** — the closest conceptual relative. NSF-funded, 29 billion triples, 30+ datasets, S2-cell spine, RCC-8 relations precomputed. Covers ZCTAs, FIPS codes, GADM counties, NWS zones, CBSAs.

**But: no census tracts, no block groups, no ZIP↔tract crosswalks, no allocation weights, no temporal versioning or boundary lineage.** Its `Region` is a static conceptual place, not a versioned entity.

Status: GitHub org quiet since **Sep 2025**. Its only public SPARQL endpoint has an **expired TLS certificate** — no TLS-verifying client can reach it. Its status page lists all seven services as "not monitored." It is absent from FRINK/Proto-OKN, the federal KG-hosting infrastructure that would have sustained it, and its canonical registry entry points at the wrong endpoint. *Borrow the ontology (CC BY 4.0) and the S2-cell join pattern; do not depend on the data.*

**Ordnance Survey linked data** — **withdrawn**. The best-resourced national linked-geodata service in the world was killed and replaced with a plain OGC feature API. This is the single most instructive data point in the review.

**LinkedGeoData** — abandoned; the project's own site annotates a dependency *"the project seems dead."*

**[UrbanKG / UrbanKGent](https://dl.acm.org/doi/10.1145/3588577)** — two cities (NYC, Chicago), POI/road-network semantics, no tracts or crosswalks. The knowledge is **LLM-extracted**, which is the opposite of the epistemic status a crosswalk product needs. Artifacts are real (MIT, weights released) but it is research code, not a service.

**GeoSPARQL 1.1** ([OGC 22-047r1](https://docs.ogc.org/is/22-047r1/22-047r1.html)) — the one thing here worth actively adopting, for vocabulary interoperability. But it models **crisp** containment and has no vocabulary for *weighted partial* containment, which is the entire point of a crosswalk. You would be extending it, not adopting it — and that extension is arguably the defensible ontological contribution.

**Pattern:** correct, elegant, well-published artifacts that nobody kept running, because SPARQL-endpoint-as-product has no revenue model and no reliability owner. **A research grant cannot fund an SLA.**

---

## 4. Vernacular neighborhoods — the only genuine partial overlap

**[Who's on First](https://whosonfirst.org/)** — actively maintained (repos updated Aug 2026). Genuinely does neighborhoods: macrohood/microhood placetypes, hierarchies, concordances, rich alt-names. Primary boundary provider for Pelias/geocode.earth.

Caveats: WOF says of itself *"our gazetteer is absolutely not finished… some of the data will be wrong."* US neighborhood polygons are substantially inherited from Zetashapes/Quattroshapes — crowd/Flickr-derived, plausible rather than authoritative. And it blends **312 sources with heterogeneous licenses**, which for commercial use is a per-record provenance audit, not a blanket grant.

**[Overture Maps divisions](https://docs.overturemaps.org/guides/divisions/)** — has exactly the right schema: 12 subtypes down to microhood, `hierarchies[]`, `parent_division_id`, `names.rules[]` with alternates. Monthly releases.

Caveats: sources are OSM + geoBoundaries, and Overture's own docs say sub-county coverage is **"often spotty."** US neighborhood polygons exist only where mappers drew them, and coverage can *regress* month-over-month outside your control. **Divisions is ODbL — share-alike on derived databases**, a live constraint on a commercial semantic layer.

**Neither connects a neighborhood to census geography with weights.** The name→polygon half is largely solved; the polygon→statistical-geography-with-weights half is not.

The de facto US corpus remains [Zillow's neighborhood shapefiles](https://www.zillowgroup.com/news/7000-neighborhood-boundary-files-in-shapefile-format/), **frozen at 2017** and still redistributed by the EPA and ArcGIS nine years later.

---

## 5. Agent benchmarks — the white space

| Benchmark | Scope | Best score |
|---|---|---|
| [GeoBenchX](https://arxiv.org/html/2503.18129v2) | Multi-step geospatial tool use | Claude Sonnet 3.5, **53%** |
| [GeoHaluBench](https://arxiv.org/html/2507.19586v1) | Geospatial hallucination, OSM/Foursquare KG | Proprietary models **47–50%** |
| GeoAnalystBench | Spatial analysis workflow + code generation | — |
| [GeoExT probing](https://ceur-ws.org/Vol-3969/paper7.pdf) | Country-level reverse geocoding | — |

**Every one stops at country, city or POI level. None tests US statistical geography.**

GeoBenchX's named failure modes map directly onto this thesis: *"not filtering to appropriate administrative levels,"* *"confusing centroids with full polygons,"* *"over-reliance on internal knowledge."* And GeoExT finds models markedly prefer answering over abstaining — the fabrication behavior UGEO-Bench caught directly.

---

## 6. The two warnings that matter most

**[UrbanInstitute/geocrosswalk](https://github.com/UrbanInstitute/geocrosswalk) is the exact relational spec, already built.** `convert_geolevel()`, `harmonize_by_time()`, bundling Geocorr + NHGIS + Census tables with population/land-area/housing weights. **8 stars, 0 forks, stalled, work moved elsewhere.** Competent people at a serious institution shipped precisely this and found no audience. That is a demand signal, not a supply gap, and it is the most important thing in this review to sit with.

**The official Census MCP is one roadmap item from eating the core.** CC0, government-maintained, 81 stars, already does `resolve-geography-fips`. If they add relationship files, the crosswalk pillar evaporates.

---

## 7. What survives

1. **Geocorr as an API.** The canonical US allocation-factor engine is a web form; the underlying SAS macro is explicitly not exposed. An agent in a sandbox physically cannot reach it. NHGIS is extract-request-then-download — minutes, not milliseconds, unusable inside an agent turn without pre-materialization. Reconciling HUD (quarterly) + Census relationship files + Geocorr-grade allocation into one weighted graph **with provenance per edge** is a durable gap.

2. **Vernacular neighborhood resolution**, unowned by anyone — open source, commercial or MCP.

3. **The benchmark itself.** No paper and no benchmark evaluates LLM agents on US statistical-geography relations. Publishing the eval may be worth more strategically than the server, and it is the thing the Census Bureau will not ship.

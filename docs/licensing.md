# Licensing and data terms

**Status:** current · verified 2026-09-18 against each source's published terms. `NOTICE` carries
the attributions; this page records what each source requires and how the project meets it.

## The project's code

Apache-2.0 (`LICENSE`). No third-party code has been copied into the tree: the BLS series-id
builders, resolver, envelope and clients were written for this project and each is verified
against published ids. The repositories the 2026-09-08 benchmark studied are credited in `NOTICE`
as design inspiration.

## Data sources

| Source | What we use | Terms | How we comply |
|---|---|---|---|
| **U.S. Census Bureau** gazetteer and 2020 relationship files (`www2.census.gov`) | Geography catalog entities and overlaps | U.S. Government work, public domain (17 U.S.C. § 105) | Cited in the catalog's `catalog_meta` and `NOTICE` |
| **Census Bureau Data API** (`api.census.gov`) | Not called by the BLS server. Planned for `server-census` (M8) | [Terms of Service](https://www.census.gov/data/developers/about/terms-of-service.html): a key; no re-identification; no altering content while citing the Bureau; the sentence *"This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau."* must be displayed | The sentence goes in `census_describe_source`, the README and the connector docs when M8 lands |
| **BLS** LABSTAT area tables, Public Data API v2, QCEW open data (`download.bls.gov`, `api.bls.gov`, `data.bls.gov`) | Every BLS indicator | [API Terms of Service](https://www.bls.gov/developers/termsOfService.htm): cite the retrieval date; rate limits (500/day with a key); do not modify content and still cite BLS; the sentence *"BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov."* must appear clearly; no BLS logo | Every envelope carries `retrievedAt` and a citation with the date; the "cannot vouch" sentence is in `bls_describe_source`'s caveats, the README and `NOTICE`; the quota is enforced by the core client; no logo |
| **MCDC Geocorr 2022** (`mcdc.missouri.edu`) | The vendored national place→county allocation factors (36,179 rows) | **None published.** The Geocorr application, its help pages and MCDC's help index carry no licence, terms of use or citation policy (checked 2026-09-18). MCDC is a University of Missouri program — a state entity, so the federal public-domain rule does **not** apply to its output as a compilation, though the underlying block data are public-domain Census data and the factors are a mechanical derivation of them | Credited in `NOTICE`, the Geocorr README and the catalog build with a suggested citation and retrieval date; the file is redistributed unmodified apart from a column transform documented in the README. If MCDC ever publishes terms, or on request, the vendored file can be replaced by a build-time download (the fetch script already exists) |
| **Official Census Bureau MCP server** (`uscensusbureau/us-census-bureau-data-api-mcp`) | Reference for the planned Census server's dataset index and query grammar; no code copied | CC0 1.0 Universal (verified in its `LICENSE`): no rights reserved, no attribution required | Credited in `NOTICE` anyway |

## Open item

MCDC's silence on terms is the one source without an explicit grant. The project's position is
that redistributing a mechanically derived crosswalk of public-domain federal data, with credit,
is consistent with MCDC's purpose as a Census Bureau State Data Center partner. A courtesy email
to MCDC (Glenn Rice, riceg@missouri.edu) confirming they are comfortable with the vendored file
would close it; that is the owner's act.

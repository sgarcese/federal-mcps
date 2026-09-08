# Spike: open-source BLS MCP servers — fork or build?

**Date:** 2026-09-08 · **Outcome:** build our own, borrowing four pieces of code ·
**Rendered report:** https://claude.ai/code/artifact/f678fb93-06a0-402e-94dd-b1c31cdba1fa

## Question

Eleven open-source MCP servers wrap Bureau of Labor Statistics data. Is any a sound
foundation for a server aimed at city and state policy makers, whose needs are
local-area programs (LAUS, CES State & Area, QCEW, OEWS metro, regional CPI, state
JOLTS) resolved by place name rather than by series ID?

## Method

Candidates found via GitHub search, Glama, PulseMCP and web search; all cloned and read
at source level against a fixed rubric: local-area coverage, place-name → series-ID
resolution, API quota discipline (500/day, 50 series/request, 20 years/request),
output shaping, tests, license, activity.

## Findings

| Repo | Lang | LAUS metro/county | CES S&A | QCEW | OEWS metro | Reg. CPI | State JOLTS | Place → ID | Quota | Tests | License |
|---|---|---|---|---|---|---|---|---|---|---|---|
| cyanheads/bls-labor-mcp-server | TS/Bun | partial (FTS over LABSTAT catalog) | — | — | off by default | partial | partial | free-text search | retry, batch, SQLite mirror | ~249 | Apache-2.0 |
| pipeworx-io/mcp-bls | TS | **yes** | — | — | — | — | — | fuzzy name → 8,184-row la.area | none | 0 | MIT |
| b-barker/bls-oews-mcp | Py | — | — | — | **yes** | — | — | FIPS/MSA → OEUM builder | none | 0 | MIT |
| RakeemRanger/bls-mcp | Py/Azure | county+state | — | — | — | — | — | keyword over county FIPS | broken | 0 | none |
| harperbrian/labor-market-intelligence-mcp | TS/CF | — | — | — | — | — | — | national only | retry, KV cache | 89 | none |
| thelancehaun/workforce-data-explorer | Py | — | — | — | — | — | yes | 50-state FIPS | TTL dict | 0 | MIT |
| larasrinath/bls_mcp | TS | — | — | — | — | — | — | caller supplies IDs | none | 0 | MIT |
| kovashikawa/bls_mcp | Py | — | — | — | — | — | — | mock data only | n/a | 26 (mock) | MIT |
| AiAgentKarl/labor-market-mcp-server | Py | — | — | — | — | — | — | 17 national IDs, v1 API | none | 0 | MIT |
| shzlw/open-bls-mcp | — | empty stub | | | | | | | | | MIT |
| aarzamen/BLS-MCP | TS | not BLS ("Basic Life Support" CPR simulator) | | | | | | | | | none |

- Nobody covers QCEW or CES State & Area.
- Only two repos do anything sub-national by place or code, and neither is a runnable,
  maintained server.
- cyanheads is the only production-grade codebase but locks into the author's Bun-first
  framework and has ~10 open self-filed correctness bugs including a LAUS area-code
  parse error.
- harperbrian has the best engineering discipline (provenance envelope, tiered cache)
  but is national-only, Workers-KV-bound and unlicensed.
- Most-starred candidate: 1 star. Every repo single-author. No community to inherit.

## Recommendation (adopted)

Build a new server on the official MCP SDK. Lift:

1. pipeworx's fuzzy place-name resolver over the LAUS area crosswalk (~350 lines, MIT).
2. b-barker's OEWS series builder and area normalizer (~200 lines, MIT).
3. cyanheads' LABSTAT catalog harvester and SQLite observation mirror (~1,400 lines,
   Apache-2.0).
4. harperbrian's provenance envelope and cache design as a pattern only (no license).

Add what none has: a geography-first resolver spanning LA/SM/OE/CU/JT codes, a QCEW
CSV client, 20-year chunking, and provenance on every number.

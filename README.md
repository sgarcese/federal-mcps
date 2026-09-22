# federal-mcps

Open-source [MCP](https://modelcontextprotocol.io) servers that give city and state
policy staff U.S. federal statistics **by place**. Ask about Denver, Denver County, the
Denver metro or Colorado and get numbers that carry their source, vintage and caveats —
never a figure without a citation, never a fabricated one.

**Status:** live. The Bureau of Labor Statistics server is deployed and answering
([`bls.responsive.city/mcp`](https://bls.responsive.city/mcp)), on a shared
geography core ([`geo.responsive.city/mcp`](https://geo.responsive.city/mcp)).
Apache-2.0. Census and CDC PLACES servers follow on the same core.

## Why this exists

Federal data APIs are organized around series and variable IDs. The hard part for an
analyst is turning "unemployment rate in Denver" into `LAUCN080310000000003` — and
knowing that the **city**, the **county** and the **metro** are three different answers
that don't nest. Every server here resolves places through one shared geography catalog,
so the same question works the same way against every agency, results join on a common
GEOID, and the server **stops and asks** when a name is ambiguous rather than guessing.

## What it answers today (BLS)

Every server exposes the same six family verbs — `resolve_place`, `get_indicator`,
`compare_places`, `list_indicators`, `get_raw`, `describe_source` — prefixed per agency
(`bls_get_indicator`). One tool call returns one indicator for one place over time, in a
provenance envelope (value, resolved place, series id, vintage, footnote flags, citation).

| Program | Indicator(s) | Coverage | Pickers |
|---|---|---|---|
| **LAUS** | unemployment rate, unemployment, employment, labor force | state · metro · county · city ≥25k (smaller cities fall back to their county, flagged) | — |
| **CES State & Area** | payroll employment (total nonfarm) | state · metro (multi-state metros served under their first state, flagged) | — |
| **OEWS** | occupational wage (mean annual) | state · metro | `occupation` (22 SOC major groups) |
| **CPI** | consumer price index | ~23 metros → census division → region → U.S. city average, each step flagged | `item` (all items, food, housing, shelter, energy, gasoline, medical care, …) |
| **JOLTS** | job openings, hires, quits, layoffs | state | — |
| **QCEW** | covered employment, average weekly wage | county · state · metro (suppressed cells flagged) | `industry` (NAICS sectors) · `ownership` (total, private, government) |
| **PPI** | producer price index | national only; place optional, flagged when given | `item` (final demand, all commodities, inputs to construction, lumber, steel, concrete, …) |

Pickers are optional named arguments on `bls_get_indicator` and `bls_compare_places`;
`bls_list_indicators` publishes each indicator's vocabulary.

Numbers carry their caveats: preliminary/revised flags, the below-threshold county
fallback, and "no local series" substitutions all travel in the envelope — a tool never
silently drops or invents a value.

## Try it

The servers speak MCP over **stateless Streamable HTTP** — add the URL as a custom
connector in Claude, Claude Code, or any MCP host (no auth; the data is public):

```
https://bls.responsive.city/mcp        # BLS: labor, wages, prices
https://census.responsive.city/mcp     # Census: ACS estimates with margins of error, decennial counts
```

New to connectors? [`docs/connect.md`](docs/connect.md) has one-screen, copy-paste steps
for each host and what to ask once you're connected. The connector is read-only and keeps
no user data; see [`docs/privacy.md`](docs/privacy.md).

A typical exchange: resolve the place, then read a number.

```jsonc
// bls_resolve_place  { "query": "Denver" }
//   → candidates: Denver County (050), Denver city (160), Denver metro (310) — pick one

// bls_get_indicator  { "place": "Denver", "kind": "county", "indicator": "unemployment_rate" }
//   → 4.3% (2026-M07), series LAUCN080310000000003, with a ready-to-paste BLS citation

// bls_compare_places { "indicator": "occupational_wage",
//                      "places": ["Colorado","Utah","Nevada"], "kind": "state" }
//   → one row per state, aligned on the latest shared period

// census_get_indicator { "place": "Sedona", "kind": "city", "state": "AZ",
//                        "indicator": "median_household_income" }
//   → $73,738 ± $12,737 (ACS 2020–2024 5-year, reliability high), flagged: Sedona is below
//     the 65,000-person 1-year threshold — never a five-year figure passed off as one year's
```

## What it answers today (Census)

`server-census` (M8, ADR-014) serves thirteen American Community Survey headline indicators —
population, median age, median household and per capita income, poverty rate, unemployment rate,
bachelor's or higher, uninsured share, mean commute, median rent, median home value, owner-occupied
share, median housing cost — plus the 2020 decennial count, for any place in the catalog. Every
ACS value carries its margin of error and a reliability grade; the 1-year product is used at
65,000 people and above, the 5-year product below, and the answer says which. Annotation values
(insufficient sample, not applicable, controlled estimates) come back as null with the Census
meaning. `census_search_tables` finds table ids by topic and `census_get_raw` runs any Census API
query. This product uses the Census Bureau Data API but is not endorsed or certified by the Census
Bureau.

Call `bls_describe_source` to see coverage and cadence, or `bls_list_indicators` for the
vocabulary and which programs publish at a given place's level.

## Design in one paragraph

Many small agency servers on one shared core, not one government mega-server. The core
([`packages/core`](packages/core)) provides the geography resolver, an HTTP client that
respects each agency's quota (retry, backoff, batching, budget counter), a provenance
envelope on every result, and a server shell that enforces the family's tool conventions.
Series and variable IDs are **built** by pure, unit-tested functions from
(geography, measure) — never hand-typed. Servers run as remote Streamable HTTP endpoints
or as local stdio processes. See [`docs/architecture.md`](docs/architecture.md) for the
full design and [`docs/adr/`](docs/adr) for the decisions behind it.

## Repository layout

- [`packages/core`](packages/core) — shared runtime: geography, HTTP client, envelope, server shell.
- [`packages/geography-build`](packages/geography-build) — builds the SQLite geography catalog (a release artifact).
- `packages/server-<agency>` — one deployable MCP server per agency (`server-bls`, `server-geo`, …).
- [`terraform/`](terraform) — infrastructure (deployed locally, ADR-007).
- [`docs/`](docs) — architecture, ADRs, spikes; [`docs/README.md`](docs/README.md) is the index.

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup and
the workflow, and [`CLAUDE.md`](CLAUDE.md) for the full development conventions (TDD,
one issue per PR, spike → rulings → ADR → build).

## Security

The servers are read-only and serve only public federal statistics. To report a
vulnerability, see [`SECURITY.md`](SECURITY.md).

## License

Apache-2.0 — see [`LICENSE`](LICENSE). Data sources and their terms are recorded in
[`docs/licensing.md`](docs/licensing.md) and credited in [`NOTICE`](NOTICE). BLS.gov cannot
vouch for the data or analyses derived from these data after the data have been retrieved from
BLS.gov; every answer carries its retrieval date and citation.

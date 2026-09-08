# federal-mcps

Open-source MCP servers that give city and state policy staff federal statistics **by
place**. Ask about Denver, Denver County, the Denver metro or Colorado and get numbers
that carry their source, vintage and caveats.

Release 1 ships the **Bureau of Labor Statistics** server: local unemployment (LAUS),
payroll employment by metro (CES State & Area), county employment and wages by industry
(QCEW), occupational wages by metro (OEWS), regional CPI and state job openings (JOLTS).
Census and CDC PLACES servers follow on the same core.

Status: planning. See [`docs/architecture.md`](docs/architecture.md) for the design and
[`docs/README.md`](docs/README.md) for the documentation index.

## Why this exists

Federal APIs are organized around series and variable IDs. The hard part for a policy
analyst is turning "unemployment rate in Denver" into `LAUCT082000000000003`, and knowing
that the city, the county and the metro are three different answers. Every server here
resolves places through one shared geography catalog, so the same question works the
same way against every agency, and results join on a common GEOID.

## Design in one paragraph

Many small agency servers on one shared core, not one government mega-server. The core
provides the geography resolver, an HTTP client that respects each agency's quota, a
provenance envelope on every result, and a server shell that enforces the family's tool
conventions. Servers run as remote Streamable HTTP endpoints or as local stdio
processes, with no end-user authentication because the data is public.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) for the development conventions (TDD, one issue per PR,
spike → rulings → ADR → build). Work is tracked in GitHub issues and milestones.

## License

Apache-2.0. See [`LICENSE`](LICENSE). Borrowed code is attributed in `NOTICE` when it
lands.

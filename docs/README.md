# Documentation index

Current documents only. Superseded material moves to `archive/` with a banner.

## Design

- [architecture.md](architecture.md) — the family design: shared core, one server per
  agency, composite endpoint, deployment, roadmap, open decision questions.

## Spikes (completed analyses)

- [spikes/bls-mcp-benchmark.md](spikes/bls-mcp-benchmark.md) — eleven open-source BLS
  MCP servers evaluated; decision to build rather than fork.
- [spikes/geography-catalog.md](spikes/geography-catalog.md) — reference sources and
  design for the shared geography catalog and place resolver.

## ADRs

- [ADR-001](adr/ADR-001-agency-servers-on-a-shared-core.md) — many agency servers on
  one shared core; composite front door later; Release 1 is BLS only; independent
  project.
- [ADR-002](adr/ADR-002-toolchain-deployment-and-testing.md) — TypeScript on the
  official SDK, stateless Streamable HTTP on Lambda via CDK, fixture-driven TDD,
  Apache-2.0.
- [ADR-003](adr/ADR-003-shared-geography-catalog.md) — build-time SQLite geography
  catalog and a single resolver with ambiguity-stops semantics.

## Stories

`stories/` — backlog source of truth. Empty until Phase 0 issues are cut from rulings.

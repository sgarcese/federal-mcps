# ADR-001: Many agency servers on one shared core, with an optional composite front door

**Status:** accepted (2026-09-08) · **Spikes:** [`bls-mcp-benchmark`](../spikes/bls-mcp-benchmark.md) ·
**Affects:** repository shape, every `packages/server-*`, `packages/core`

## Context

The project's goal is federal statistics by place for city and state policy staff,
across several agencies (BLS first, then Census, CDC PLACES, later HUD, BEA, FEMA). The
question was whether to build one "government data" MCP server or several agency servers
with architectural alignment. The benchmark found no fork-worthy BLS server, so the shape
is ours to choose.

## Decision

1. **One monorepo (`federal-mcps`)** with `packages/core`, `packages/geography-build`,
   one `packages/server-<agency>` per agency, a later `packages/server-composite`, and
   `infra/`. This repository is the monorepo root; the BLS server lives under
   `packages/server-bls`.
2. **One deployable MCP server per agency.** Each exposes 8–12 tools using the family
   verb set (`resolve_place`, `list_indicators`, `get_indicator`, `compare_places`,
   `get_raw`, `describe_source`) where the verb applies, prefixed by agency
   (`bls_get_unemployment`).
3. **Alignment is enforced by code.** `core.createServer` applies annotations
   (`readOnlyHint: true`), the provenance envelope and both transports; a contract test
   suite fails any server that departs from the verb set, omits the envelope, or ships
   its own place lookup.
4. **A composite server** (later release) mounts several agency servers under one URL
   with prefixed tools and a single shared `resolve_place`, for users who want one
   connector. A plugin bundles connectors plus cross-agency skills.
5. **Release 1 ships the BLS server only.** Core interfaces are judged by whether a
   second agency server would need to change them.
6. **Independent project.** No dependency on, or framing around, any particular agent
   platform. Any MCP host is a first-class consumer.

## Consequences

- Tool lists stay small enough for a model to read at once; agencies release, break and
  get permissioned independently; registries can list each server by what it does.
- Cross-agency questions require several connectors (or the composite) in one
  conversation; the shared GEOID in every envelope is what makes the join work.
- We never start with a mega-server and split later; adding a composite is additive.

## Alternatives rejected

- **One mega-server with search-and-execute tools.** Hides the tool surface behind a
  discovery round-trip and couples every agency's release cycle.
- **Fork `cyanheads/bls-labor-mcp-server`.** Production-grade but bound to a
  single-maintainer Bun framework, missing CES State & Area and QCEW, with ~10 open
  self-filed correctness bugs. Its LABSTAT harvester and mirror are borrowed instead.

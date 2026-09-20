# Documentation index

Current documents only. Superseded material moves to `archive/` with a banner.

## Design

- [architecture.md](architecture.md) — the family design: shared core, one server per
  agency, composite endpoint, deployment, roadmap, open decision questions.
- [connect.md](connect.md) — non-developer quickstart: add the hosted BLS connector by
  URL in Claude.ai, Claude Code, or any MCP host, and what to ask once connected.
- [install.md](install.md) — developer install: Claude Code and Claude Desktop stdio
  configs (npm and local checkout), and the remote HTTP endpoint.
- [licensing.md](licensing.md) — data-source terms (Census, BLS, MCDC Geocorr, the official
  Census MCP server's CC0) and how the project meets each; `NOTICE` carries the credits.
- [privacy.md](privacy.md) — the connector's privacy policy: what a tool call sends, what
  the hosted endpoint logs (30 days), and that no conversation data is ever received.
- [directory-readiness.md](directory-readiness.md) — the Anthropic connector-directory
  review-criteria checklist pass and the drafted submission portal fields (M6.3, #138).

## Spikes (completed analyses)

- [spikes/bls-mcp-benchmark.md](spikes/bls-mcp-benchmark.md) — eleven open-source BLS
  MCP servers evaluated; decision to build rather than fork.
- [spikes/geography-catalog.md](spikes/geography-catalog.md) — reference sources and
  design for the shared geography catalog and place resolver.
- [spikes/geo-ontologies/](spikes/geo-ontologies/README.md) — imported research and the
  UGEO-Bench benchmark that shaped M2 (ADR-008).
- [spikes/geography-hosting.md](spikes/geography-hosting.md) — datastore, serving topology
  and retrieval interface for the geography catalog (feeds ADR-008 decision 1).
- [spikes/m7-functional-completions.md](spikes/m7-functional-completions.md) — M7 inventory of
  every deferred BLS item (pickers, metro/region completions, PPI) with nine decision questions.
- [spikes/m9-cdc-places.md](spikes/m9-cdc-places.md) — M9 CDC PLACES server: verified Socrata
  facts (2025 release datasets, 40 measures, two value types with 95% intervals, per-measure data
  years, suppression) and nine decision questions.
- [spikes/m8-census.md](spikes/m8-census.md) — M8 Census server: verified ACS facts (key now
  mandatory, vintages, 65k rule, sentinels, headline variables) and eleven decision questions.
- [spikes/census-server-suitability.md](spikes/census-server-suitability.md) — the official Census
  Bureau MCP server re-checked against the family contract (2026-09-18): build on the core, borrow
  its data index and query grammar; six decision questions.

## ADRs

- [ADR-001](adr/ADR-001-agency-servers-on-a-shared-core.md) — many agency servers on
  one shared core; composite front door later; Release 1 is BLS only; independent
  project.
- [ADR-002](adr/ADR-002-toolchain-deployment-and-testing.md) — TypeScript on the
  official SDK, stateless Streamable HTTP on Lambda via CDK, fixture-driven TDD,
  Apache-2.0.
- [ADR-003](adr/ADR-003-shared-geography-catalog.md) — build-time SQLite geography
  catalog and a single resolver with ambiguity-stops semantics.
- [ADR-004](adr/ADR-004-responsive-city-deployment-target.md) — Responsive City
  account, fleet record, GitHub OIDC role bootstrapped once with `rc-deploy`, one API
  hostname per server.
- [ADR-005](adr/ADR-005-terraform.md) — Terraform replaces CDK; S3 state bucket in the
  bootstrap; native `terraform test`; loader script shared by CI and tests.
- [ADR-006](adr/ADR-006-responsive-city-naming-state-and-secrets.md) — the account's
  actual pattern: `rc-*` names, the shared `rc-tfstate` bucket, agency keys as sensitive
  Terraform variables; no administrator step.
- [ADR-007](adr/ADR-007-local-deploys-matching-the-account-pattern.md) — deploy locally
  with `scripts/deploy.sh` under `rc-deploy`; no GitHub OIDC role; CI validates only.
- [ADR-008](adr/ADR-008-geography-catalog-v2.md) — geography catalog v2: weighted overlap
  and tract lineage as data, structured flags not prose, a hosted `server-geo`, and
  UGEO-Bench as the M2 exit gate (amends ADR-003).
- [ADR-009](adr/ADR-009-labor-market-core-laus.md) — M3 labor market core: LAUS data tools
  over the family verbs, built series ids, the below-threshold county fallback, and the
  BLS timeseries API (LABSTAT mirror deferred to #51).
- [ADR-010](adr/ADR-010-m4-wages-prices-openings.md) — M4 wages/prices/openings: CES, OEWS,
  CPI and JOLTS as headline indicators behind a program registry, `bls_compare_places`, and
  CPI's nearest-published-area handling.
- [ADR-011](adr/ADR-011-m5-qcew.md) — M5 QCEW: the first non-timeseries program (CSV area
  slices) over a registry fetch capability; county/state headline; disclosure codes as caveats.
- [ADR-012](adr/ADR-012-m6-release-hardening.md) — M6 release hardening: an eval set vs the live
  server, a connector quickstart, the connector review criteria as a quality bar (no submission,
  amended), and the first tag v0.1.0 (0.x, minor per milestone).
- [ADR-013](adr/ADR-013-m7-functional-completions.md) — M7 functional completions: dimension
  pickers as named arguments on the registry, OEWS/CES/QCEW metro completions, Census regions and
  divisions in the catalog, and a national-scope PPI program (v0.2.0).
- [ADR-014](adr/ADR-014-m8-census-server.md) — M8 Census server: thirteen ACS headline indicators
  plus decennial population on the registry seam; 1-year/5-year by population, margins of error,
  reliability grades and annotation sentinels as first-class data; vendored table index (v0.3.0).

## Runbooks

- [runbooks/bootstrap-instance.md](runbooks/bootstrap-instance.md) — the
  one-time, human-run steps that deploy `FederalMcpsCiCd` and create an
  instance's agency secrets (ADR-004 §3, the sole exception to CI-only
  deploys).

## Stories

`stories/` — backlog source of truth. Empty until Phase 0 issues are cut from rulings.

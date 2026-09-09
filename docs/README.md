# Documentation index

Current documents only. Superseded material moves to `archive/` with a banner.

## Design

- [architecture.md](architecture.md) — the family design: shared core, one server per
  agency, composite endpoint, deployment, roadmap, open decision questions.
- [install.md](install.md) — connecting to the BLS server: Claude Code and Claude
  Desktop stdio configs, and the remote HTTP endpoint once it is deployed.

## Spikes (completed analyses)

- [spikes/bls-mcp-benchmark.md](spikes/bls-mcp-benchmark.md) — eleven open-source BLS
  MCP servers evaluated; decision to build rather than fork.
- [spikes/geography-catalog.md](spikes/geography-catalog.md) — reference sources and
  design for the shared geography catalog and place resolver.
- [spikes/geo-ontologies/](spikes/geo-ontologies/README.md) — imported research and the
  UGEO-Bench benchmark that shaped M2 (ADR-008).

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

## Runbooks

- [runbooks/bootstrap-instance.md](runbooks/bootstrap-instance.md) — the
  one-time, human-run steps that deploy `FederalMcpsCiCd` and create an
  instance's agency secrets (ADR-004 §3, the sole exception to CI-only
  deploys).

## Stories

`stories/` — backlog source of truth. Empty until Phase 0 issues are cut from rulings.

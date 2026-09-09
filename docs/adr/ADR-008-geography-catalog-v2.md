# ADR-008: Geography catalog v2 — weighted overlap, lineage, structured flags, a hosted resolver, and a benchmark gate

**Status:** accepted (2026-09-09) · **Amends:** ADR-003 §1 (bundled-only) and §3 (single vintage) ·
**Spikes:** [`geography-catalog`](../spikes/geography-catalog.md), [`geo-ontologies/`](../spikes/geo-ontologies/README.md) ·
**Affects:** `packages/core/src/geography`, `packages/geography-build`, a new `packages/server-geo`, `terraform/`, the envelope

## Context

M1 shipped the shared core and the BLS server. Before building the geography catalog (M2),
the owner's prior research — imported at `docs/spikes/geo-ontologies/` — was reviewed and
ruled on (2026-09-09). UGEO-Bench (55 items, four model arms) found:

- Frontier models already know the geographic rules (Opus 0.95 conceptual, 0.94 with no
  tools), so a prose advisory layer is nearly free for them and largely ignored by them.
- Small models fail silently and fabricate (Haiku 0.545; states the caveat then does the
  wrong thing). The value is making cheap agents safe, and the design rule is **structured
  flags a caller can branch on, not prose**.
- The genuinely unowned, highest-value data is **weighted overlap** (ZIP/ZCTA↔tract
  allocation shares; Geocorr has no API) and **tract lineage** (2010→2020; the Census API
  returns an empty response, not an error, for a retired tract). Both scored worst across
  every model arm.
- Prior art warns this is a demand problem (Urban Institute shipped the exact crosswalk
  spec and it stalled), so the geography is built first for our own servers, not as a
  standalone product chasing an audience.

## Decision

1. **Two front doors, one catalog.** Geography ships as (a) an in-process library in
   `packages/core` that every agency server calls, and (b) a standalone hosted MCP server
   `packages/server-geo` (`rc-geo-mcp-<env>`, `geo-mcp.responsive.city`) exposing
   `resolve_place`, `get_containment`, `get_overlap`, `get_lineage`, `list_availability`
   and `describe_source`. Both read the same versioned catalog (engine per the hosting spike). This is what the
   composite server's shared `resolve_place` becomes. (Reopens ADR-003 §1: bundled *and*
   hosted, not bundled-only.)
2. **The catalog carries weighted overlap and lineage as data.** Census 2020 relationship
   files plus a vendored Geocorr export populate `containment.share`; a `lineage` relation
   holds 2010→2020 tract succession. We store the crosswalk and shares; we do **not** build
   areal-interpolation math (geosnap already does that). (Reopens ADR-003 §3: the single
   vintage gains a lineage table.)
3. **Structured flags, not prose.** Every geography result carries machine-checkable flags
   in the envelope: `below_threshold` (e.g. a place under the LAUS 25k cutoff),
   `non_nesting`, `vintage_mismatch`, `suppressed`, `cdp`, `consolidated_city`, `ambiguous`.
   The BLS server's prose instructions stay for frontier models but stop being the only
   guardrail. `resolve_place` still returns `status: ambiguous` and stops (ADR-003 §7).
4. **UGEO-Bench is the M2 exit gate.** The imported benchmark runs in-repo; M2 passes when
   a small model shows a demonstrable lift on it with the geography tools versus without.
   The full benchmark is used, since it is the instrument that demonstrated the value.
5. **Deferred, with reasons.** Vernacular neighborhood names — a "neighborhood" is
   use-dependent (Boston's Leather District is a distinct parking neighborhood but not a
   mailing one), there is no single boundary to resolve to, and the corpora are
   licensing-encumbered; full multi-vintage history beyond 2010/2020; and Census/CDC
   agency codes, which land with those servers.

## Datastore and serving (ruled 2026-09-09, hosting spike #50)

The hosting spike (`docs/spikes/geography-hosting.md`) evaluated the datastore engine,
the AWS serving topology and the retrieval interface against the workload (read-only,
sub-gigabyte, fuzzy name lookup + fixed-depth hierarchy + weighted-overlap joins, from a
Lambda and in-process, inside an agent turn). The owner accepted its recommendations:

6. **Embedded SQLite, one versioned artifact.** The catalog is a single `.sqlite` file
   built by `packages/geography-build`, opened read-only with **better-sqlite3** (not
   Node's built-in `node:sqlite`, whose official builds omit FTS5). FTS5 with a trigram
   tokenizer does fuzzy names; recursive CTEs do the hierarchy; indexed edge tables with
   a weight column do overlap and lineage.
7. **Bundled as a versioned npm asset.** `@rc/geo-catalog@<vintage>` carries the file;
   the hosted `server-geo` and every in-process library depend on it, so the file is
   baked into each Lambda's own zip — local memory-mapped reads, no network hop, no VPC,
   no new IAM role. Refresh is a redeploy. The escape hatch, when the unzipped footprint
   nears ~200 MB (the 250 MB code+layers cap) or refresh must decouple from deploys, is
   an S3 object downloaded once per cold start to `/tmp`.
8. **MCP-native; REST and GraphQL deferred.** The core is a plain
   `resolvePlace(query) → envelope` the MCP tools call; a REST read API is an additive
   adapter added only when a non-MCP consumer appears. GraphQL is not planned.
9. **Rollout by immutable artifact.** A new catalog is a new package version (or S3 key);
   the hosted server publishes a new Lambda version and moves its alias via local
   `terraform apply`; in-process hosts pin an exact version and upgrade deliberately.
   Read-only data swaps whole-file, so there is no in-place migration.
10. **The BLS data mirror is a separate store** (spike #51, a later milestone): Parquet
    on S3 queried by DuckDB, not co-located with geography. DuckDB may later serve as one
    query client over both, but is not introduced until the mirror lands.

Graph databases (Neptune) and always-on relational databases (Aurora Serverless v2) are
rejected in the spike: containment is fixed-depth indexed joins, not graph traversal, and
a read-only sub-gigabyte dataset gains nothing from a server it must reach over the
network and pay a floor for.

## Consequences

- `server-geo` follows every account rule already established: `rc-geo-mcp-<env>` names,
  state in the shared `rc-tfstate` bucket, an admin-provisioned execution role read by
  Terraform (ADR-006, ADR-007), local deploy via a per-server `deploy.sh`.
- The catalog is the first dependency of every server; its build pipeline and the
  UGEO-Bench gate get their own M2 sub-issues.
- Redelineations, county changes and the 2020 vintage are data refreshes and a catalog
  version bump, not code changes.

## Alternatives rejected

- **Bundled-only, in-process (ADR-003 as written).** Rejected: the research shows the value
  concentrates in cheap agents that cannot reach Geocorr or parse 100 MB files, which a
  hosted resolver serves directly; and the resolver is the composite server's `resolve_place`
  regardless.
- **A prose advisory layer as the guardrail.** Rejected: small models ignore prose caveats
  and contradict them; flags survive where paragraphs do not.
- **Building vernacular neighborhoods now.** Deferred: unowned but use-dependent, hard, and
  irrelevant to BLS and policy work.

# Spike: hosting the geography catalog — datastore, serving topology, retrieval interface

**Date:** 2026-09-09 · **Feeds:** ADR-008 decision 1 (marked pending) · **Issue:** #50 ·
**Related:** the BLS mirror spike (#51)

## Question

ADR-008 settled *what* the geography layer is (an in-process library plus a hosted
`server-geo`, over one versioned catalog) but deferred *how* it is stored and served.
Pick the datastore engine, the AWS serving topology, and the retrieval interface, against
the real workload rather than in the abstract.

## The workload

- Read-only. Rebuilt from source files annually, some decennially. A refresh is a whole
  new versioned artifact, never an in-place write.
- Small: about 200k entities, low-millions of crosswalk edges, well under 1 GB (realistic
  30–300 MB).
- Query mix, in priority order: fuzzy/prefix name lookup ("Denver" → ranked candidates);
  exact lookup by GEOID/FIPS; shallow fixed-depth hierarchy (place → county → CBSA → CSA →
  state); weighted overlap (ZCTA → tracts with allocation shares); tract lineage
  (2010 → 2020).
- Callers: the hosted `server-geo` Lambda, and other Node Lambdas in-process (the BLS
  server resolves places without a network hop). Latency matters; this runs inside an LLM
  agent turn.
- Account constraints (ADR-004 through ADR-007): Node 22 arm64 Lambda behind an HTTP API,
  Terraform, `rc-<service>-<env>` names, admin-provisioned execution roles (the deploy
  identity cannot create IAM roles or put a function in a VPC on its own), local deploys.

## Recommendation

**Datastore: embedded SQLite, one versioned `.sqlite` artifact, via better-sqlite3 with
FTS5.** It serves every access pattern from one file: B-tree lookups (sub-millisecond,
in-process, no network), FTS5 with a trigram tokenizer for fuzzy names, recursive CTEs for
the fixed hierarchy, and indexed edge tables with a weight column for overlap and lineage.
Fuzzy name resolution is the deciding factor and SQLite does it best of the options without
a second system. Use better-sqlite3, not Node 22's built-in `node:sqlite`, because the
official Node builds compile it without FTS5.

**Serving topology: bundle the catalog into the deployment artifact as a versioned
npm-package asset.** For a sub-gigabyte read-only file this gives the lowest and most
predictable in-turn latency (the file sits on local disk, memory-mapped, zero network), and
it is the only topology that also serves the in-process-library case cleanly: any host
Lambda that depends on the `@rc/geo-catalog` package gets the file baked into its own zip,
so it resolves places with no S3 permission and no runtime download. It needs no VPC and no
new IAM role, which matters given the account's role constraint. Refresh is a redeploy,
which is fine for a dataset that changes a few times a year.

**Retrieval interface: MCP-native tools returning the provenance envelope. Defer REST and
GraphQL.** The consumer is an LLM picking typed tools and getting a fixed rich envelope; it
does not compose nested queries, so GraphQL's client-shaped selection buys nothing. A REST
read API would only help a non-MCP consumer (a dashboard, a partner service), of which there
are none yet, and it is a thin additive adapter over the same resolver whenever one appears.
Build the core as a plain `resolvePlace(query) → envelope` so that stays a one-file change.

**Refresh and rollout:** immutable versioned artifacts (`@rc/geo-catalog@2026.1`), pinned
per release. The hosted server bumps the dependency and `terraform apply` publishes a new
Lambda version and moves the `prod` alias, optionally weighted for a brief canary; rollback
is an alias move. In-process hosts pin an exact package version and upgrade deliberately, so
no host changes silently. There is no in-place migration because read-only data swaps
whole-file.

## Why not the alternatives

- **A graph database (Neptune).** Containment is a fixed, shallow, known-shape chain, which
  is a sequence of indexed equi-joins, not a graph traversal; weighted overlap and lineage
  are weighted bipartite edge sets, one indexed table each. Neptune would store the same
  edges with more overhead, a network hop, a VPC, an always-on floor around $80/month, and an
  ~80-second cold start, to answer questions a B-tree already answers. It would only pay off
  for unbounded, arbitrary-depth graph analytics, which annual Census geography never reaches.
- **An always-on relational database (Aurora Serverless v2 + PostGIS).** For a read-only,
  annually-rebuilt, sub-gigabyte dataset there is no write path to serialize and no
  concurrency to coordinate, so the value of a shared server is unused, while the costs are
  real: a network hop per lookup, a VPC and connection story from Lambda, and either a
  standing min-capacity bill or a ~15-second resume from scale-to-zero on the first request.
  Everything we want from Postgres (SQL, indexes, FTS, recursive CTEs) is present in SQLite.
- **DynamoDB.** Great for exact key lookups, but it cannot do fuzzy name search natively
  (the deciding factor), and modeling overlap and hierarchy is awkward. It would force an
  OpenSearch bolt-on, which is unjustified at ~30k named places.
- **A search cluster (OpenSearch).** Justified at millions of documents or heavy write
  throughput, neither of which applies. FTS5 covers fuzzy resolution at this scale.
- **EFS, or S3 queried in place.** EFS forces the function into a VPC (cold-start ENI
  overhead, IAM the account can't self-provision); S3-in-place pays S3 latency on every query
  inside an agent turn.

**Escape hatch, with an explicit trigger:** if the catalog's unzipped footprint approaches
~200 MB (leaving margin under the 250 MB code-plus-layers Lambda cap), or refresh must
decouple from code deploys, switch to an S3 object downloaded once per cold start to `/tmp`
(configurable to 10 GB with no measurable cold-start penalty), optionally from S3 Express One
Zone for single-digit-millisecond first byte. Warm reads then match the bundled path. Below
that line, bundle.

## The BLS data mirror (informs, does not change, the above)

The owner raised hosting a cached copy of BLS time-series data to bypass the API's
500-queries-per-day cap (spike #51). It has a different shape than the geography catalog:
larger (the LABSTAT bulk files are the full published series, plausibly multi-gigabyte across
programs), refreshed monthly, and queried by `(series_id, period-range)` with occasional
filtered scans — no fuzzy search, no graph traversal. The finding:

- **Two stores, kept separate.** Geography stays bundled SQLite. The mirror wants a
  columnar store: **Parquet on S3 queried by DuckDB**, partitioned by program and year and
  sorted by `series_id` so row-group statistics prune a series-and-range query to a few
  byte-range reads. Its monthly refresh is a clean new-dated-prefix artifact, and a few
  hundred milliseconds of warm latency is fine because the mirror exists to dodge the API
  cap, not to serve a sub-50 ms lookup.
- **One query client, if wanted.** DuckDB in a Lambda can `ATTACH` the read-only geography
  SQLite file and read the BLS Parquet, so callers can have one SQL surface without merging
  the datasets into one engine. This does not change the geography recommendation; it only
  means "two specialized stores" need not mean two query stacks.
- **DynamoDB for the mirror** only if the dominant pattern turns out to be high-QPS lookups
  of individual series (an API-like read tier), not analytical subset access; the monthly
  bulk reload and cross-series scans make it the wrong economics otherwise.

## Decision questions

1. **Adopt embedded SQLite (better-sqlite3 + FTS5), bundled as a versioned artifact, for the
   geography catalog** (recommended)? This finalizes ADR-008 decision 1.
2. **MCP-native only, deferring REST and GraphQL** behind a stable resolver (recommended),
   with a REST read API added if a non-MCP consumer appears?
3. **Bundle now, S3-to-`/tmp` as the documented escape hatch** at the ~200 MB / decoupled-
   refresh trigger (recommended), or go straight to S3-to-`/tmp` for refresh independence?
4. **The BLS mirror is a separate Parquet-on-S3 + DuckDB store** (recommended, tracked in
   #51 for a later milestone), not co-located with geography?
5. **DuckDB as the shared query client** that can read both stores — adopt now, or keep the
   geography library on better-sqlite3 alone and introduce DuckDB only when the mirror lands
   (recommended: the latter, to avoid an alpha dependency before it is needed)?

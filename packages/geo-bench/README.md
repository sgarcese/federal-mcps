# @federal-mcps/geo-bench

UGEO-Bench in-repo (#60, ADR-008 §4): run a small model **with** and **without** the
geography MCP tools and measure the lift on the relational categories the tools target.
This is M2's exit gate.

The benchmark itself lives, verbatim, under
[`docs/spikes/geo-ontologies/benchmark/benchmark.json`](../../docs/spikes/geo-ontologies/benchmark/benchmark.json).
This package only reads it — it is never edited here. The design and the original imported
run are in [`docs/spikes/geo-ontologies/02-BENCHMARK-RESULTS.md`](../../docs/spikes/geo-ontologies/02-BENCHMARK-RESULTS.md);
the in-repo gate procedure and its results log are in
[`docs/spikes/geo-ontologies/GATE-RESULTS.md`](../../docs/spikes/geo-ontologies/GATE-RESULTS.md).

## What is and isn't a merge gate

The offline pieces — batch generation, scoring, exact-number grading, the report — are
unit-tested and run in CI. **Running a live model arm and the LLM judge is a manual,
LIVE_TESTS-style job, not a merge gate**: it needs an Anthropic API key, the built
`@rc/geo-catalog`, and it bills tokens. It is run deliberately, and its result is recorded
in `GATE-RESULTS.md`.

## The two arms

| Arm | Tools | What it isolates |
|---|---|---|
| `without_tools` | none | the model's parametric knowledge |
| `with_tools` | the geography MCP tools (`geo_resolve_place`, `geo_get_containment`, `geo_get_overlap`, `geo_get_lineage`, `geo_list_availability`) over the bundled catalog | the lift the resolver buys |

The gate passes when the tool arm shows a meaningful lift on the **relational** categories
(`weighted_overlap`, `temporal_succession`, `containment`) — the ones a resolver over the
catalog is built to answer.

## Commands

```sh
# offline: reproducible batches (categories de-clustered so traps don't prime the model)
npm run geo-bench -w @federal-mcps/geo-bench -- batches

# live: run BOTH arms (needs a key + the built catalog)
export ANTHROPIC_API_KEY=sk-...
export GEO_CATALOG_PATH=packages/geography-build/dist/geo-catalog@2025.sqlite   # npm run geography:build
npm run geo-bench -w @federal-mcps/geo-bench -- run out.json            # add --limit N to sample

# live: grade both arms with the LLM judge (rubric: all must_include, no must_not_claim → trap caps at 0)
npm run geo-bench -w @federal-mcps/geo-bench -- grade out.json graded.json

# offline: print the with/without table, the relational lift, and the gate verdict
npm run geo-bench -w @federal-mcps/geo-bench -- report graded.json
```

## Grading

`exact_number` items are graded programmatically (a stated number within the item's
tolerance). Everything else is graded by an LLM judge working only from the rubric or the
ground truth, exactly as in the imported run — every `must_include` concept required, any
`must_not_claim` trap caps the item at 0.

## Caveat on catalog coverage

The tool arm only helps where the built catalog actually holds the benchmark's data (the
Boston/Suffolk and Philadelphia metros: ZCTA↔tract overlaps, 2010→2020 tract lineage, the
Connecticut planning-region succession). If a metro or relation is absent from the catalog
build, the tool arm cannot lift those items — that is a catalog-coverage finding, recorded
in `GATE-RESULTS.md`, not a harness bug.

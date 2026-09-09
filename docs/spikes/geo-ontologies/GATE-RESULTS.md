# UGEO-Bench — the M2 exit gate (in-repo)

This is the results log for the **in-repo** UGEO-Bench gate (#60, ADR-008 §4), run by
[`packages/geo-bench`](../../../packages/geo-bench). It is distinct from
[`02-BENCHMARK-RESULTS.md`](02-BENCHMARK-RESULTS.md), which records the original imported
run whose arms were *tool-enabled vs closed-book* (web search and open-data MCPs). The gate
here asks a narrower, product-specific question:

> Does a small model do measurably better on the relational categories **with our
> geography MCP tools** than with no tools at all?

The gate passes when the `with_tools` arm shows a meaningful lift over `without_tools` on
`weighted_overlap`, `temporal_succession` and `containment` — the relations a resolver over
the catalog is built to answer.

## Why the imported run already points the right way

The imported study (`02-BENCHMARK-RESULTS.md`) established the two facts this gate depends
on, with the same benchmark and grading:

- **The relational categories are where a resolver should help.** Every sub-perfect score in
  both frontier arms fell in exactly `weighted_overlap` and `temporal_succession`; the six
  conceptual categories saturate and carry no signal.
- **A small model degrades most on precisely those relations.** Haiku scored `weighted_overlap`
  0.20 and `temporal_succession` 0.69 (overall 0.545) — the headroom a resolver call can
  recover, since it returns the exact overlap/lineage a small model otherwise guesses or
  fabricates.

The in-repo gate closes the loop by swapping the tool set from "web search + open-data MCPs"
to "our geography MCP tools" and measuring the same small model with vs without them.

## How to run it

See the package [README](../../../packages/geo-bench/README.md). In short, with an Anthropic
API key and the built catalog:

```sh
export ANTHROPIC_API_KEY=sk-...
export GEO_CATALOG_PATH=packages/geography-build/dist/geo-catalog@2025.sqlite
npm run geo-bench -w @federal-mcps/geo-bench -- run out.json
npm run geo-bench -w @federal-mcps/geo-bench -- grade out.json graded.json
npm run geo-bench -w @federal-mcps/geo-bench -- report graded.json
```

`report` prints the with/without table, the relational lift, and a GATE verdict line.

## Result log

> Pending a live run. The harness, grading and report are in place and unit-tested; running
> the live arms needs an API key and the built `@rc/geo-catalog`, and bills tokens, so it is
> a deliberate manual job (like a deploy). Record each run below: the model, the catalog
> vintage, the per-category table, and the relational lift.

| Date | Model | Catalog vintage | Overall lift | Relational lift | Verdict |
|---|---|---|---|---|---|
| _tbd_ | claude-haiku-4-5 | _tbd_ | _tbd_ | _tbd_ | _tbd_ |

### Catalog-coverage note

The tool arm can only lift items whose data the built catalog actually holds — the
Boston/Suffolk and Philadelphia ZCTA↔tract overlaps, 2010→2020 tract lineage, and the
Connecticut planning-region succession. If the gate shows no lift on a relation, first
confirm the catalog build covers those metros for that relation; a gap there is a
catalog-coverage finding, not a harness fault, and belongs in the geography-build backlog.

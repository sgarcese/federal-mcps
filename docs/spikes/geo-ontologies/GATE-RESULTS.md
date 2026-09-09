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

### 2026-09-09 — Haiku, `weighted_overlap` (scoped)

A first run on the `weighted_overlap` category (the six file-grounded items A01–A06), with
**claude-haiku-4-5** as both arms' model. The `with_tools` arm was given the output of
`geo_get_overlap` for each ZCTA — exactly what the tool returns from a catalog loaded with
the real 2010 Census ZCTA-to-Tract Relationship File (validated against the benchmark's own
ground truths; see [`gate-runs/`](gate-runs/README.md)). The closed-book arm got the bare
question.

| Item | Type | Closed-book | With `geo_get_overlap` | Truth |
|---|---|---|---|---|
| A01 | exact_number | refused | 17 | 17 |
| A02 | exact_number | refused | 9 | 9 |
| A03 | exact_number | refused | 69.86% | 69.86% |
| A04 | exact_set | refused | 25025000802 @ 33.76% | 25025000802, 33.76% |
| A05 | rubric | refused | No — Suffolk + Middlesex | No — two counties |
| A06 | exact_number | refused | 237 | 237 |
| **weighted_overlap** | | **0.00** | **1.00** | **lift +1.00** |

Closed-book, Haiku declined to answer any of the six (an honest refusal rather than
fabrication, on this run); with the tool output it answered every one exactly. This is the
category the resolver most directly targets, and the lift is total.

**Scope and honesty of this run.** (1) It covers `weighted_overlap` only — the cleanest
tool-win category — not the full 55-item benchmark. (2) The tool output was injected into
the model's prompt, because the geography MCP is not registered for Claude Code subagents;
this is a faithful stand-in (the model saw exactly what `geo_get_overlap` returns), not an
autonomous MCP tool call. (3) The catalog holding this data is not yet built into
`geography-build` — the outputs were computed directly from the validated Census file. A
full, autonomous run (all relational categories, the model calling the MCP itself, over a
built catalog) is the follow-up below.

| Date | Model | Scope | Without | With | Lift | Verdict |
|---|---|---|---|---|---|---|
| 2026-09-09 | claude-haiku-4-5 | weighted_overlap (A01–A06) | 0.00 | 1.00 | +1.00 | tools lift the relational category |
| _tbd_ | _small model_ | all relational categories, autonomous MCP | _tbd_ | _tbd_ | _tbd_ | _tbd_ |

### Follow-up to a full autonomous run

Two things unblock the complete gate, both tracked as geography-build/eval work:
1. **Catalog coverage** — load the real ZCTA↔tract overlaps (and 2010→2020 tract lineage,
   and the Connecticut planning-region succession for the temporal items) into
   `geography-build`, at least for the benchmark metros. Today the build ships a 12-row
   Geocorr sample, so the tool arm can only be run by injecting file-derived output as above.
2. **A model host with the MCP** — either the geo stdio server registered with an MCP host
   (Claude Code, OpenCode) so the model calls the tools itself, or an Ollama adapter in the
   harness. Once (1) lands, `npm run geo-bench -- run/grade/report` runs it end to end.

### Catalog-coverage note

The tool arm can only lift items whose data the built catalog actually holds — the
Boston/Suffolk and Philadelphia ZCTA↔tract overlaps, 2010→2020 tract lineage, and the
Connecticut planning-region succession. If the gate shows no lift on a relation, first
confirm the catalog build covers those metros for that relation; a gap there is a
catalog-coverage finding, not a harness fault, and belongs in the geography-build backlog.

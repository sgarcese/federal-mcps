# Research summary — what was tried, what was learned, and how

## The goal

Convert "a geospatial knowledge-graph MCP seems like a good idea" into a measured question: **does an LLM agent doing US urban geospatial work actually fail without this, and at what specifically?**

## What was built

1. **UGEO-Bench v0.1** — 55 items across 8 categories, anchored on Suffolk County MA (25025) and Philadelphia County PA (42101). 11 items have exact answers computed from authoritative crosswalk files; 44 are rubric-graded with explicit `must_include` concepts and `must_not_claim` traps, where hitting a trap caps the item at zero. Every item carries a `kg_relation` field mapping it to the semantic-layer edge type that would fix it.
2. **Four experimental arms** plus a validity ablation.
3. **A prior-art review** across academic geo-knowledge-graphs and shipped software.

## How it was actually done

**Ground truth, under a hostile network.** The sandbox blocked `census.gov`, the city open-data portals, and ArcGIS at the network layer. Rather than fabricate, the work routed around it three ways:

- GitHub mirrors of the official Census ZCTA-to-Tract Relationship File and the HUD USPS crosswalk, located by a sourcing agent that tested roughly fifteen hosts and reported which failed.
- The Boston and Philadelphia open-data MCP servers, whose *server-side* network reached what the sandbox shell could not.
- WebFetch for targeted facts, which could reach census.gov even though curl could not.

A separate agent independently fact-checked twelve structural claims against the Federal Register, TIGERweb, BLS program documentation and OMB Bulletin 23-01 **before any of them entered the answer key**. That agent caught the sourcing agent asserting the opposite of the truth about ZCTAs crossing state lines — an artifact of the sourcing agent working from 2010-vintage state-partitioned files, when the 2020 delineation is a single national file with ~130–140 ZCTAs spanning state lines. That contradiction became benchmark item A10.

**Contamination control.** The answer key was moved to a directory the answering agents were instructed never to read. Questions were seeded-shuffled so categories don't cluster within a batch, limiting cross-question priming. Graders never saw the answers being produced and worked only from the rubrics.

**Self-checking the instrument.** When six of eight categories came back saturated at 1.00, the obvious suspicion was that the questions telegraph their own traps — *"any issues?"*, *"how do I correctly…"*, *"what error does this introduce?"*. So eight of the most-cued items were rewritten as flat user requests with no hint anything was wrong (*"Compute the median household income for the tract"* from five block-group medians; *"Write me a Python function that takes a ZCTA and returns its state"*) and rerun. That ablation is the reason the conceptual result is believable rather than an artifact.

**Verification.** Every number in the results was recomputed from the graded output and asserted programmatically — including the claim "all failures fall in two categories," which was checked with an assertion rather than asserted in prose.

## What was learned — in three reversals

### Round 1 — the benchmark contradicted the initial advice

The advice given at the outset was that the valuable layer was *"here's the right geography, the right vintage, and the caveats that make your answer defensible."*

The frontier model scored **0.95 on exactly that**, and **0.94 with no lookup tools at all**. Web search added +0.01 across 44 conceptual items. The de-cued ablation scored **8/8** — every trap raised unprompted. Every single failure in both arms fell into two categories: relational resolution and vintage lineage.

**Conclusion: cut the advisory layer, build the resolver.**

### Round 2 — prior art narrowed the resolver

Nobody ships this as an MCP. Zero servers anywhere expose HUD crosswalks, Census relationship files, NHGIS crosswalks, or neighborhood-name resolution.

But the *library* ecosystem covers 70–80% of the scope. `geosnap.harmonize()` (275★, actively maintained) does tract lineage in one call with dasymetric interpolation. `zippeR` (updated June 2026) already wraps HUD and UDS crosswalks. **Tract lineage is not a differentiator.**

What survives: Geocorr has no API; vernacular neighborhood resolution is unowned; and no benchmark exists for agents on statistical geography.

Two warnings emerged. `UrbanInstitute/geocrosswalk` is this exact spec, already built, stalled at 8 stars. And the geo-knowledge-graph graveyard is real — KnowWhereGraph's only public endpoint has an expired TLS certificate, Ordnance Survey withdrew its linked-data service entirely, LinkedGeoData is abandoned.

### Round 3 — model size reversed Round 1

| Category | n | Opus + tools | Opus closed-book | **Haiku + tools** | gap |
|---|---|---|---|---|---|
| containment | 7 | 1.00 | 1.00 | **0.50** | −0.50 |
| control | 5 | 1.00 | 1.00 | **0.80** | −0.20 |
| data_availability | 8 | 1.00 | 1.00 | **0.69** | −0.31 |
| jurisdiction_routing | 6 | 1.00 | 1.00 | **0.50** | −0.50 |
| multi_step_planning | 5 | 1.00 | 1.00 | **0.60** | −0.40 |
| reliability | 6 | 1.00 | 1.00 | **0.58** | −0.42 |
| temporal_succession | 8 | 0.88 | 0.81 | **0.69** | −0.19 |
| weighted_overlap | 10 | 0.75 | 0.45 | **0.20** | −0.55 |
| **OVERALL** | **55** | **0.936** | **0.873** | **0.545** | **−0.391** |

Conceptual/rubric items: **0.95 → 0.58**. The de-cued ablation: **1.00 → 0.44**, with the trap raised unprompted in only **3 of 8** cases. Fabrication flagged in **7 of 55** answers.

**Cost makes it worse, not better.** Haiku used 337k tokens and **387 tool calls** against Opus's 655k and **417**. It did 93% of the tool work for 58% of the accuracy.

## What this means

**The answer to "what should I build" depends on which model your users run — and that is the actual finding.**

- **Frontier models:** build the narrow resolver. Geocorr-grade allocation as an API with per-edge provenance, plus a vernacular gazetteer. Skip the advisory layer, skip tract lineage as a headline. The pitch is determinism, cost and traceability — not accuracy.
- **Small models:** the advisory layer originally recommended for deletion is the **highest-value part of the system**. Containment semantics, dataset-geography availability and reliability guardrails all collapse below the frontier, and they collapse *silently*, with fabricated supporting figures.

This reframes the product from "make good agents slightly better" to **"make cheap agents safe enough to deploy on this class of work"** — a larger market and a clearer claim. It also argues for shipping guardrails as structured return fields rather than prose, since a small model ignores prose caveats and will contradict its own.

## Limitations — stated plainly

1. **n=55, one sample per item, one run per arm.** No confidence intervals. Category cells of 5–10 items are directional only.
2. **LLM graders throughout.** They worked from strict rubrics and flagged key discrepancies rather than silently regrading, but nothing was human-adjudicated.
3. **The sandbox network block** handicapped the tool-enabled arms on precisely the relational items, inflating the apparent value of a resolver there. Partly realistic — the relationship files are 100MB+ national text files no agent parses in-context — but the number is not clean. A rerun with unrestricted access is the highest-value follow-up.
4. **Exact items use 2010-vintage** ZCTA × tract data; the 2020 file was unobtainable in that environment. Questions state the vintage, so ground truth is correct as asked, but 2020 crosswalks are untested.
5. **The Haiku arm is one model, one run.** Treat −0.39 as a signal about model-size sensitivity, not a precise coefficient.
6. **Six categories saturate for frontier models** and therefore carry no signal there. v0.2 should harden them and expand `weighted_overlap` and `temporal_succession`, which discriminate at every model size.

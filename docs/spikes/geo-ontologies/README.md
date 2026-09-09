> **Imported research (spike).** This folder was produced in a prior Claude session
> (research August 2026, documents rebuilt September 2026) by the project owner and
> imported into the repository on 2026-09-09 as the deliberation behind M2 (ADR-008).
> The raw run artifacts (individual agent responses, per-item graded JSON) were lost
> when that session's container was reclaimed; the benchmark, the aggregate results and
> every source URL survive here. Content is unchanged from the import except this note.

# Geo-Ontologies — research record

Work on a proposed geospatial semantic-layer MCP for US urban analytics: a service that gives LLM agents exact, sourced answers about how American geographic units relate to each other.

**Bottom line:** build a narrow relational lookup service with structured guardrails, not a knowledge graph. The value is concentrated in things a small model gets wrong silently, and in relations no existing tool serves. Start with the benchmark, not the server.

## Read in this order

| Doc | What it is |
|---|---|
| [`00-PROPOSAL.md`](00-PROPOSAL.md) | **Start here.** Plain-language proposal — what to build, what to leave out, how you'd know it worked |
| [`01-RESEARCH-SUMMARY.md`](01-RESEARCH-SUMMARY.md) | What was tried, how it was done, and the three times the conclusion reversed |
| [`02-BENCHMARK-RESULTS.md`](02-BENCHMARK-RESULTS.md) | UGEO-Bench v0.1 — design, four arms, results, failure analysis |
| [`03-PRIOR-ART.md`](03-PRIOR-ART.md) | Who else has built this, what shipped, what died, and why |
| [`benchmark/benchmark.json`](benchmark/benchmark.json) | The 55-item benchmark with ground truth, rubrics and sources |
| [`benchmark/harness.py`](benchmark/harness.py) | Seeded batch generation and scoring |

## The three findings that matter

1. **Frontier models already know the rules.** Claude Opus scored 0.95 on the conceptual/advisory items — the layer originally proposed as the core of the product — and 0.94 with no lookup tools at all. Web search added +0.01.

2. **Small models do not, and they fail silently.** Claude Haiku scored 0.58 on the same items, 0.545 overall against Opus's 0.936. It equated a Boston neighborhood with a ZIP code, denied that a ZCTA crossed a county line, and invented a poverty rate for a county that no longer exists. Fabrication was flagged in 7 of 55 answers.

3. **Nobody ships the relational layer, but libraries cover most of it.** Zero MCP servers anywhere expose crosswalks, tract lineage, or neighborhood-name resolution — but `geosnap` and `zippeR` already do lineage and ZIP→tract in a sandbox. What remains unowned: Geocorr-grade allocation as an API, and vernacular neighborhood names.

## Status and provenance

Research conducted August 2026; documents rebuilt September 2026. All findings, scores and citations are preserved. The raw run artifacts — individual agent responses and per-item graded JSON — were lost when the original session container was reclaimed. The benchmark itself, the aggregate results, and every source URL survive here.

Ground truth was built from the Census 2010 ZCTA-to-Tract Relationship File and the HUD USPS ZIP Crosswalk (2021 Q4), with conceptual facts independently verified against the Federal Register, TIGERweb, BLS program documentation and OMB Bulletin 23-01 before entering the answer key.

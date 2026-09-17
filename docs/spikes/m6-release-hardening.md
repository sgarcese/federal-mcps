# Spike: M6 — Release hardening (eval, adoption, v1.0.0)

M1–M5 delivered the BLS server (six programs: LAUS, CES, OEWS, CPI, JOLTS, QCEW) and the shared
geography core, deployed and live at `bls-mcp.responsive.city`. M6 is the "make it a real 1.0"
milestone: prove it answers policy questions well, make it easy for a non-developer to connect,
submit it to the Anthropic connector directory, and tag v1.0.0. Unlike M1–M5 this is partly
product- and UX-shaped, so the decisions below are about *what "done" means*, not new machinery.

## What M6 delivers

- An **eval set** of real policy questions run against the live server, rubric-scored — the gate for
  "does this actually answer well," not just "does it respond."
- A **connector quickstart** — the one-screen "add this URL" path for the people the tool is for.
- A **directory submission** meeting Anthropic's connector review criteria.
- **v1.0.0**: a tagged release with notes and `NOTICE` attribution.

## The decisions (numbered; recommendations given)

### 1. Eval set: scope, scoring, and threshold

The product's value is answering place-based questions correctly *with the caveats that matter*, so
the eval must test the judgment calls, not just happy-path lookups. **Recommendation:** a small
(~20–30) set of real questions in `docs/evals/` (JSONL + a runner), each with a **rubric** (what a
good answer must include / must not claim), run against the **live** server, in the spirit of
UGEO-Bench (`docs/spikes/geo-ontologies/`). Cover:
- One headline lookup per program (unemployment, payroll, wage, CPI, job openings, QCEW wages).
- The **judgment cases** that are the product's core value: a below-25k city (LAUS → county, flagged);
  a no-local-CPI place (→ U.S. city average, flagged); an ambiguous bare name ("Denver" → stops and
  asks); a suppressed QCEW cell (→ null + disclosure, never fabricated); city vs county vs metro not
  interchangeable.
- A compare-places question and a "which program publishes here" (`list_indicators`) question.

Scoring is rubric-based (a grader model checks each rubric), reported as pass-rate; **threshold: an
agreed bar (recommend ≥ 90% of must-include rubrics, 0 must-not-claim violations)**. The eval is a
**reported gate, not a CI merge gate** (it hits the live API and a grader) — run before a release.

### 2. Connector quickstart: who it's for and where it lives

The audience is city/state policy staff, not developers. **Recommendation:** a short
`docs/connect.md` (linked from the README's "Try it") with copy-paste steps for the common hosts —
Claude/Claude.ai (Settings → Connectors → add `https://bls-mcp.responsive.city/mcp`), Claude Code
(`claude mcp add`), and "any MCP host" — plus a 3-line "what to ask" (resolve the place, then ask
for a number) and the ambiguity/caveat behaviour a user will notice. No auth, public data.

### 3. Directory submission: meet the review criteria first

**Recommendation:** a pre-submission checklist pass against Anthropic's connector review criteria
(read-only tools with correct annotations — already enforced by the contract suite; tool
name/description limits; prompt-injection and safety rules; a working test connection identifying as
`claude-ai`). Record the pass in `docs/` and submit after the eval bar is met. The servers are
already read-only and annotated, so this is mostly verification + the submission form.

### 4. v1.0.0: what "1.0" asserts

**Recommendation:** tag **v1.0.0** once the eval bar is met, the quickstart is published, and the
directory submission is prepared. Release notes summarize the six BLS programs + geography core and
name the known limitations (metro CES multi-state, OEWS metros, QCEW metro/NAICS pickers, CPI item
pickers, region/division CPI). Ensure `NOTICE` attributes any borrowed code. v1.0 = "the BLS
server is complete and adoptable," not "every program has every dimension."

### 5. Release-1 scope boundary

**Recommendation:** Release 1 (v1.0.0) is the **BLS server + geography core**. Census and CDC PLACES
servers, and the composite endpoint, are post-1.0. The deferred sub-dimension work (below) is post-1.0
too — 1.0 ships the headline of each program, done well and adoptable.

## Roadmap beyond M6 (captured here; not built in M6)

The owner raised **"inflation by type of good, e.g. construction material pricing by geography over
time."** Verified against the live BLS API, this resolves into three distinct things:

1. **CPI by expenditure category (feasible, high value).** CPI publishes item-level series for the
   ~23 metros and the U.S. — verified: Denver returns food, housing, energy, gasoline and medical,
   not just all-items. This is the deferred **CPI item picker**: add an `item` argument + a curated
   item vocabulary (all-items, food, housing, energy, medical, apparel, transportation, …) to
   `cpi_all_items`/a new `cpi` indicator. It would answer "how has energy or housing inflation moved
   in Denver vs Phoenix over time." **Proposed as the next feature milestone (M7).**

2. **Construction *labor* cost by geography (feasible via QCEW).** QCEW already gives us
   construction-industry (NAICS 23) employment and average weekly wage **by county**; the deferred
   **QCEW NAICS picker** would expose it. That is construction-sector wages/employment by place over
   time — a labor-cost proxy, not material prices.

3. **Construction *material* prices by geography (not available from BLS).** Construction material
   price indices are **PPI** (Producer Price Index, e.g. "inputs to construction"), which BLS
   publishes **national only** — no metro or state breakdown exists. A future **PPI program** could
   serve the national trend, but "by geography" is not a query BLS data can answer for material
   prices. This should be stated plainly to users rather than approximated.

**Suggested post-1.0 sequencing:** M7 = **sub-dimension pickers** (CPI items, QCEW NAICS/ownership,
OEWS occupations — one shared "add a dimension argument + vocabulary" shape, since each program's
fetch already exists); then metro completions (CES multi-state, OEWS/QCEW metro); then new programs
(PPI national, then Census/CDC servers). M7 gets its own spike when we reach it.

## Proposed build-issue cut for M6 (from the rulings, not before)

1. **Eval set + runner** — `docs/evals/` questions with rubrics; a runner that hits the live server
   and grades; a reported pass-rate.
2. **Connector quickstart** — `docs/connect.md` + README "Try it" link.
3. **Directory-submission readiness** — review-criteria checklist pass + prepared submission.
4. **v1.0.0 release** — tag, release notes, `NOTICE`, and the known-limitations list.

## Out of scope for M6

New indicators or dimensions (CPI items, QCEW NAICS, OEWS occupations, metros — M7), new programs
(PPI), new agency servers (Census/CDC), and the LABSTAT mirror (#51).

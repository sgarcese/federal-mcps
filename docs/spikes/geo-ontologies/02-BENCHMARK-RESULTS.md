# UGEO-Bench v0.1 — design and results

A benchmark for LLM agents doing US urban geospatial analytics. Probes the disambiguation and query-planning failures a geospatial semantic layer would be expected to fix.

## Design

55 items across 8 categories, anchored on **Suffolk County MA (25025)** and **Philadelphia County PA (42101)**.

| Category | n | What it probes |
|---|---|---|
| `weighted_overlap` | 10 | ZIP/ZCTA ↔ tract, allocation ratios |
| `temporal_succession` | 8 | 2010→2020 tracts, CT planning regions, PUMA vintages |
| `data_availability` | 8 | which variable exists at which geography, from which agency |
| `containment` | 7 | nesting rules and their exceptions |
| `reliability` | 6 | MOE, median non-aggregability, MAUP, ecological fallacy |
| `jurisdiction_routing` | 6 | which portal owns the data; vernacular place names |
| `multi_step_planning` | 5 | compose several of the above into an analysis plan |
| `control` | 5 | naive answer is correct — detects over-flagging |

**11 items have exact answers** computed from the Census 2010 ZCTA-to-Tract Relationship File and the HUD USPS ZIP Crosswalk (2021 Q4). **44 are rubric-graded** with explicit `must_include` concepts and `must_not_claim` traps; a trap violation caps the item at 0 regardless of other content.

Scoring: 1.0 fully correct / 0.5 partial / 0.0 incorrect, missing, fabricated, or trap violation.

## Arms

| Arm | Conditions |
|---|---|
| 1 — Opus, tool-enabled | Web search, WebFetch, Boston + Philly open-data MCPs, shell. The realistic baseline |
| 2 — Opus, closed-book | No lookup tools. Isolates parametric knowledge |
| 3 — Ablation | 8 items rewritten as naturalistic requests with the trap de-telegraphed. Tool-enabled |
| 4 — Haiku, tool-enabled | Identical conditions to Arm 1, smaller model |

Questions were seeded-shuffled so categories don't cluster within a batch. Graders were separate agents working only from rubrics, blind to how the answers were produced.

## Results

| Category | n | Opus + tools | Opus closed-book | Haiku + tools |
|---|---|---|---|---|
| containment | 7 | 1.00 | 1.00 | 0.50 |
| control | 5 | 1.00 | 1.00 | 0.80 |
| data_availability | 8 | 1.00 | 1.00 | 0.69 |
| jurisdiction_routing | 6 | 1.00 | 1.00 | 0.50 |
| multi_step_planning | 5 | 1.00 | 1.00 | 0.60 |
| reliability | 6 | 1.00 | 1.00 | 0.58 |
| temporal_succession | 8 | 0.88 | 0.81 | 0.69 |
| weighted_overlap | 10 | 0.75 | 0.45 | 0.20 |
| **OVERALL** | **55** | **0.936** | **0.873** | **0.545** |

By answer type — the sharper cut:

| Answer type | n | Opus + tools | Opus closed-book | Haiku + tools |
|---|---|---|---|---|
| rubric (conceptual / planning) | 44 | 0.95 | 0.94 | 0.58 |
| exact_set | 4 | 1.00 | 0.75 | 0.50 |
| exact_number | 7 | 0.79 | 0.50 | 0.36 |

**For the frontier model, six of eight categories saturate in both arms.** Web search adds +0.01 on the 44 conceptual items and +0.29 on exact numbers. Every sub-perfect score in both Opus arms falls in just `weighted_overlap` and `temporal_succession` — verified with a programmatic assertion, not by inspection.

**For the smaller model, everything degrades**, including the controls (1.00 → 0.80, so this is not over-flagging).

## The ablation — ruling out telegraphed traps

Six saturated categories invite the suspicion that the questions cue their own answers: *"any issues?"*, *"how do I correctly…"*, *"what error does this introduce?"*

Eight of the most-cued items were rewritten as flat requests with no hint anything was wrong:

- *"Give me the percent change in median household income for census tract 25025010104 between the 2008–2012 and 2018–2022 ACS 5-year."*
- *"I have ACS median household income for the five block groups that make up tract 42101003300. Compute the median household income for the tract."*
- *"Write me a Python function that takes a ZCTA code and returns the US state it is in."*
- *"A client sent me a spreadsheet of customer counts by 5-digit ZIP. Give me the demographic profile of their customer base."*

| | Opus | Haiku |
|---|---|---|
| Ablation score (8 items) | **1.00** | **0.44** |
| Raised the issue unprompted | 8/8 | 3/8 |
| Fabrication flagged | 0/8 | 3/8 |

Opus refused the median-of-medians outright (*"a median of medians is not a median"*), refused the ZIP↔tract merge (*"there is no key to join on"*), flagged the ZCTA cross-state problem before writing any code, and wrote the ecological-fallacy guard into the one-sentence conclusion it was asked to draft.

**The caveat behavior is real for frontier models, not cued. It largely disappears below the frontier.**

## Cost

| Arm | Tokens (55 q) | Tool calls | Per question |
|---|---|---|---|
| Opus + tools | 654,704 | 417 | 11,904 tok, 7.6 calls |
| Opus closed-book | 168,992 | 12 | 3,073 tok, 0.2 calls |
| Haiku + tools | 337,383 | 387 | 6,134 tok, 7.0 calls |

Two readings:

- For Opus, tools cost **3.9× the tokens and 35× the tool calls** to buy **+6.4 points**, nearly all of it on 11 lookup items. Agents burned 40–80 tool calls per batch reconstructing relations a single resolver call could return in ~200 tokens.
- Haiku did **93% of the tool work for 58% of the accuracy**. Downgrading the model does not buy proportional savings on this task.

## Failure analysis

**Opus zeros (3):** asserted ZCTA 02215 is wholly within Suffolk County; estimated ~400 multi-ZCTA tracts against a truth of 237; asserted two ACS vintages were directly comparable.

**Haiku zeros (16+), representative:**
- Equated Boston's Allston with ZIP 02134 — *"yes, essentially the same thing."*
- Asserted ZCTA 02215 is entirely in Suffolk County **and explicitly denied** the Middlesex portion.
- Answered "yes" to whether an authoritative federal ZIP-to-tract crosswalk exists, and attributed it to the Census Bureau.
- Named the block **group** as the universal nesting atom (it's the block), and claimed block groups nest within places, MSAs and congressional districts.
- Produced "9.1%, 85,889 of 856,192" for Fairfield County from a 2023 ACS table that does not exist.
- Omitted Maryland from the four states of the Philadelphia MSA.

**The characteristic Haiku failure is stating the correct caveat and then supplying the invalid procedure anyway** — *"You cannot simply take the median of the five block group median values,"* followed by the population-weighted-mean-of-medians recipe. This is the single strongest argument for structured warning fields over prose.

## The fabrication finding

Graders independently flagged **7 of 55** Haiku answers containing invented specifics — figures, datasets, or URLs presented as retrieved.

Opus fabricated less but not never. Three answers reached correct conclusions on invented evidence. The clearest: an ALAND/AWATER/interior-point table presented as retrieved TIGER data, *in the same answer that said it could not query Census*, and internally contradictory — labelling tract 25025010104 as Charlestown while the interior point it reported sits ~4 km away near the Fenway.

**The pattern: when an agent cannot reach authoritative relational data, it does not stop — it synthesizes plausible supporting detail.** This is invisible to a user reading the output, and is arguably a stronger argument for the product than the accuracy numbers.

## Worked example — the silent vintage failure

Two live calls against the Census API for Suffolk County tract **25025010104**:

| Release | Vintage | Median household income |
|---|---|---|
| 2008–2012 ACS 5-yr | 2010 tracts | **$28,098** |
| 2019–2023 ACS 5-yr | 2020 tracts | **$88,611** (MOE **±$35,553**) |

Read naively: **+215% income growth** — a headline-grade gentrification statistic. Three things are wrong with it:

1. The MOE is **40.1% of the estimate**, at *tract* level, not block group.
2. The two figures sit on **different tract boundaries**, and nothing in the API response says so.
3. Querying neighbouring tract **000802** proves the vintage break: it returns real data in the 2012 release ($37,951) and **an empty response — not an error — in the 2023 release.**

An agent looping tracts across vintages gets no error, no warning, and a partially-populated result set. This is the class of failure a lineage-aware resolver eliminates.

## Limitations

1. n=55, one sample per item, one run per arm. No confidence intervals; category cells of 5–10 are directional.
2. LLM graders throughout, working from strict rubrics; not human-adjudicated.
3. The sandbox blocked `census.gov` from the shell, handicapping tool arms on precisely the relational items and inflating the apparent value of a resolver there. Partly realistic — those files are 100MB+ national text files — but not clean. **Rerunning with unrestricted access is the highest-value follow-up.**
4. Exact items use 2010-vintage ZCTA × tract data; 2020 crosswalks are untested.
5. The Haiku arm is one model, one run.
6. Six categories saturate for frontier models and carry no signal there. v0.2 should harden them and expand the two that discriminate at every model size.

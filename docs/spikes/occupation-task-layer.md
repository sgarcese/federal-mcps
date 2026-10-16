# Spike: an occupation and task layer — O*NET and the Anthropic Economic Index (#360)

**Status:** deferred by the owner on 2026-10-15. This is outside the plan for now, being less aligned with the family's purpose, federal statistics by place. The analysis stands for reference, and nothing is built or filed from it. #359 (OEWS percentiles and detailed occupations) is federal data and proceeds on its own.

## Why

On 2026-10-15 the owner tried to reuse the connectors to build job toolkits:
- a resume reviewer;
- an interview simulator;
- a tool that scores accomplishments for AI exposure;
- civic uses such as layoff response.

The family already answers "what does this kind of work pay here, and which local industries are growing". It cannot link an occupation to its **tasks, skills or related occupations**, or say which tasks AI is already being used for. Every toolkit idea that goes past pay depends on that link.

Two public datasets supply it:

| Source | What it gives | Licence | Form |
|---|---|---|---|
| **O*NET 31.0** (U.S. Department of Labor, ETA) | Tasks per occupation, task ratings, emerging tasks, 10 primary and 10 supplemental related occupations, technology skills | CC BY 4.0, with a fixed attribution sentence. Modified content must say "USDOL/ETA has not approved, endorsed, or tested these modifications". "O*NET" is a trademark, used only as an adjective. (Read 2026-10-15.) | Bulk download (CSV, Excel, JSON, SQL, RDF) and a web-services API |
| **Anthropic Economic Index** (`Anthropic/EconomicIndex` on Hugging Face) | `labor_market_impacts`: `job_exposure.csv` (observed AI exposure per occupation) and `task_penetration.csv` (share of each task seen in AI usage), plus earlier releases | The README says **"Data released under CC-BY, code released under MIT"**. The Hugging Face tag says MIT, which covers only the code. Treat the data as CC-BY and attribute it. | Static CSVs, versioned by release date |

## What was measured (2026-10-15)

| Join | Result |
|---|---|
| Economic Index tasks → O*NET 31.0 task statements (exact text, whitespace and case normalised) | **17,436 of 17,998 tasks (96.9%)**; **1,344 of the 1,354** tasks with non-zero AI usage |
| Economic Index tasks whose text appears under more than one O*NET occupation | 403. The occupation must come from context, not from the text. |
| `job_exposure` occupations (6-digit SOC) published by OEWS (`oe.occupation`) | **755 of 756**; only Legislators (11-1031) is missing |
| O*NET occupations with tasks | 923 O*NET-SOC 2019 codes, rolling up to **798** six-digit SOC codes, **771** of them published by OEWS |

**What this shows:**
- The join is clean. Tasks link to O*NET by text, O*NET links to SOC by truncating `15-1252.00` to `15-1252`, and SOC links to local wages through OEWS once #359 accepts detailed codes.
- No crosswalk table has to be invented. The 3% of unmatched tasks and the 27 O*NET occupations outside OEWS are stated, not hidden.

## What the toolkits need, mapped to sources

| Need | Source | Exists today? |
|---|---|---|
| Local pay by occupation, with percentiles | OEWS by metro and state | Partly: mean wage for 22 major groups only; #359 adds the rest |
| Growing local industries | QCEW by county with history; BEA GDP by industry | Yes |
| Openings and quits as negotiation context | JOLTS, state only | Yes |
| Prices and rents for relocation | BEA regional price parities (every metro); HUD Fair Market Rents | Yes. Use these, not CPI, which covers about 23 metros. |
| An occupation's tasks and related occupations | O*NET | **No** |
| Which tasks AI is used for | Economic Index | **No** |
| Occupation growth by place | OEWS history | **No**: one year only, #51 stage 1 |
| Employment projections | BLS Employment Projections (national); state programmes | **No**: a separate decision |
| Layoff triggers | State WARN notices | Out of scope: state, not federal |
| Live job postings | Commercial data | Out of scope |

## Design questions

### 1. Where the layer lives
- **(a) A core occupation catalog plus a small `occupation` server.**
  - At build time, `geography-build` (or a sibling `occupation-build`) produces an occupation catalog from O*NET 31.0, `oe.occupation` and the Economic Index, pinned by version and SHA-256 the way the Geocorr crosswalk is.
  - Core resolves occupation names to SOC codes once, the way it resolves places once ("Geography is resolved once, in core"). The BLS server uses it for #359's detailed occupations, so a user can say "registered nurse" instead of `29-1141`.
  - A new `occupation` server serves tasks, related occupations, technology skills and exposure from that catalog, using the family verbs where they apply (`list_indicators`, `get_indicator`, `get_raw`, `describe_source`). Its resolver is an occupation resolver, not a place resolver. Whether the verb set gains `resolve_occupation` is part of this question.
- **(b) Fold everything into the BLS server.** This is smaller, but O*NET and the Index are not BLS data. It blurs provenance and the citation contract.
- **(c) A source guide (skill) only**, pointing a model at O*NET's web services and the Hugging Face connector. ADR-015's test says a server: there is an ID grammar the model should never type (SOC and O*NET-SOC codes), and hosts depend on the provenance envelope. No MCP connector reaches O*NET today.

*Recommended: (a).* Occupation resolution is shared infrastructure, like geography. The data is static, so the server has no upstream quota and no limiter cost.

### 2. Sources, versions and attribution
- **Pin O*NET 31.0** and the Economic Index `labor_market_impacts` files by version and SHA-256. Rebuild only on a deliberate bump, as with Geocorr.
- **Carry the exact attribution wording in every citation:** O*NET's required sentence and the CC BY link, plus "USDOL/ETA has not approved, endorsed, or tested these modifications", because we join and roll up. Credit the Economic Index (CC-BY) with its report citation.
- **Pick an Economic Index release.** `labor_market_impacts` is one of several; newer releases add monthly aggregates. Choose one per build, and say which.

### 3. How exposure is presented
- **Name it "tasks likely to change"**, never displacement or job loss. The answer states:
  - **What is measured:** observed AI usage on tasks, from one AI provider's usage, in a stated period. That is not a forecast or a hiring signal.
  - **Uncertainty:** `observed_exposure` and `penetration` are shares of observed usage, not probabilities.
  - **What it doesn't measure:** whether jobs or tasks are actually being lost.
- **Every exposure figure travels with that caveat in the envelope.** The family's rule "Numbers carry their caveats" applies.
- **Present scores by task within an occupation, not as one number for a person.**

### 4. Where accomplishment scoring happens
- **Scoring a person's resume text belongs to the client, not the servers.** The servers return occupation tasks, task-level exposure and related occupations. The model does the matching against the person's own words.
- **Resume text must never be sent as a tool argument.** Arguments are not logged today (`privacy.md`), but the safer contract is that the tools accept only occupation codes and names. Tool descriptions say so.

### 5. Joining across taxonomies
- **O*NET-SOC 2019 is SOC 2018 plus detailed suffixes.** `.00` maps one-to-one. Codes like `15-1252.01` roll up to `15-1252` for OEWS wages, and the roll-up is stated.
- **State the gaps:** the 27 O*NET occupations OEWS does not publish, and Legislators for exposure. Never substitute another occupation silently.
- **The 403 shared task texts** are resolved by the occupation in the request, never by text alone.

### 6. Out of scope, as questions rather than build items
- **Employment projections:** BLS national projections, and state projections from a separate programme. Worth a short follow-up spike if the toolkits need forward-looking demand.
- **Aggregate "what residents are worried about":** this conflicts with the privacy promise that no arguments are logged. Only a separate, opt-in product with its own privacy terms could do it.
- **WARN notices and job postings:** state and commercial data, outside a federal-data family.

## Decisions for the owner

1. **Shape.** *Recommended:* (a), a core occupation catalog plus a small `occupation` server. *Alternatives:* (b) fold into BLS; (c) a skill only.
2. **Resolver verb.** *Recommended:* add `resolve_occupation` to the family verbs, served by core's catalog and mounted on the BLS and `occupation` servers. *Alternative:* overload `get_indicator` with free-text occupation names.
3. **Sources.** *Recommended:* O*NET 31.0 (tasks, related occupations, technology skills) and the Economic Index `labor_market_impacts` release, both pinned. *Alternative:* add task ratings and emerging tasks now.
4. **Exposure wording and caveats.** *Recommended:* the section 3 framing, with a fixed caveat sentence reviewed by the owner before build.
5. **Privacy contract.** *Recommended:* tools take occupation codes and names only, never free text from a resume; tool descriptions and `privacy.md` say so.
6. **Order of work.** *Recommended:* #359 first (pay by detailed occupation is useful on its own and is the join key), then the catalog, then the server. Bring #51 stage 1 (OEWS history) forward if "where is it growing" matters to the toolkits.
7. **Projections.** *Recommended:* a short follow-up spike only if the toolkits need forward-looking demand.

## Proposed build cut (after the rulings; nothing filed)

1. An ADR encoding the rulings.
2. The occupation catalog build: O*NET 31.0, `oe.occupation` and Economic Index files pinned by SHA-256, with the join tests from "What was measured".
3. Core `resolve_occupation`.
4. The `occupation` server: tasks, related occupations, technology skills, exposure, `describe_source` with attribution; contract tests; eval cases (including an exposure answer that carries its caveat).
5. Wiring `resolve_occupation` into BLS for #359's detailed occupations.
6. Docs: README, `connect.md`, `NOTICE`, `licensing.md`, `privacy.md`.

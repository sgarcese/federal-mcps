# ADR-012: M6 release hardening — the first tagged release (v0.1.0)

**Status:** accepted (2026-09-17) ·
**Spike:** [`m6-release-hardening`](../spikes/m6-release-hardening.md) ·
**Affects:** `docs/`, `README.md`, release process

## Context

M1–M5 delivered the BLS server (six programs: LAUS, CES, OEWS, CPI, JOLTS, QCEW) and the shared
geography core, deployed and live at `bls-mcp.responsive.city`, with the repo now public. M6 is the
first-release milestone: prove the server answers policy questions well, make it easy for a
non-developer to connect, prepare the Anthropic connector-directory submission, and cut the first
tagged release. This ADR records the M6 rulings (owner, 2026-09-17); build issues are cut from it.

## Decisions

1. **An eval set of real policy questions, rubric-scored against the live server.** ~20–30 questions
   in `docs/evals/` (a JSONL set + a runner), each with a rubric (must-include / must-not-claim),
   run against the **live** server in the spirit of UGEO-Bench. It weights the judgment cases that
   are the product's core value — below-25k city → county (flagged); no-local-CPI → U.S. city average
   (flagged); ambiguous bare name stops and asks; suppressed QCEW → null + disclosure, never
   fabricated; city ≠ county ≠ metro — alongside one headline lookup per program, a compare, and a
   `list_indicators` question. Scored by a grader as a pass-rate; bar ≥ 90% must-include, 0
   must-not-claim. A **reported gate, not a CI merge gate** (it hits the live API + a grader) — run
   before a release.

2. **A connector quickstart for non-developers.** `docs/connect.md`, linked from the README's
   "Try it", with copy-paste steps for the common hosts (Claude/Claude.ai connectors, Claude Code
   `claude mcp add`, any MCP host) plus a short "what to ask" and the ambiguity/caveat behaviour a
   user will notice. No auth; public data.

3. **The connector review criteria are the release quality bar — no directory submission.**
   Verify against Anthropic's connector review criteria (read-only tools with correct annotations
   and titles — enforced by the contract suite; name/description limits; prompt-injection and safety
   rules; a working test connection; a privacy policy) and record the pass. *Amended 2026-09-17
   (owner ruling on #135): the criteria were adopted as a proxy for quality and reliability, not as
   a path to listing; the project does not submit to the directory.*

4. **Versioning: v0.1.0 now, minor-per-milestone, 1.0.0 later.** Nothing has been tagged (M1–M5 were
   internal build milestones); **M6 cuts the first release, v0.1.0**. The project stays in `0.x` — a
   `1.0.0` is a backward-compatibility promise, and the tool contracts and indicator vocabulary are
   still growing (pickers, metros, new programs, Census/CDC). Semver pre-1.0 convention: **each
   feature milestone is a minor bump** (M6 → `0.1.0`, M7 pickers → `0.2.0`, …); **patch releases are
   fixes** (`0.1.1`). `1.0.0` is reserved for the day the API is committed stable. Release notes
   summarize the six BLS programs + geography core and name the known limitations. `NOTICE`
   attributes any borrowed code.

5. **Release-1 scope: BLS server + geography core.** Census and CDC PLACES servers, the composite
   endpoint, and the deferred sub-dimension work (below) are later. v0.1.0 ships the headline of each
   program, done well and adoptable — not every program with every dimension.

## Consequences

- v0.1.0 is the first tagged, directory-submittable release; the versioning scheme (minor per
  milestone) governs every release after.
- The eval set becomes the standing "answers well" gate, re-run before each release.
- The roadmap after M6 is recorded (not built here): **M7 = sub-dimension pickers** — CPI expenditure
  items (the owner's "inflation by type of good, by metro"), QCEW NAICS/ownership, OEWS occupations,
  one shared "add a dimension argument + vocabulary" shape. Construction *material* prices by
  geography remain out of reach — that is national-only PPI, not CPI — and must be stated plainly
  rather than approximated. Then metro completions, then a national PPI program, then Census/CDC.

## Scope

M6 = the eval set + runner, the connector quickstart, directory-submission readiness, and the v0.1.0
release (tag, notes, `NOTICE`, known-limitations). Out: new indicators/dimensions (M7), new programs
(PPI), new agency servers (Census/CDC), and the LABSTAT mirror (#51).

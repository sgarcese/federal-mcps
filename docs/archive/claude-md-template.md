> **Archived reference.** Verbatim copy of the template from https://github.com/sgarcese/santi-claude-md at 2026-09-08. The live, project-specific version is [`/CLAUDE.md`](../../CLAUDE.md).

# <Project name> — development conventions

<One-paragraph project description. Point to `docs/architecture.md` for architectural
context; ADRs live in `docs/adr/`.>

## Ground rules

- **TDD is mandatory.** Write the failing test first; acceptance criteria from the
  GitHub issue become test cases. This applies to infrastructure code (e.g. CDK
  `assertions.Template`) as much as to application packages.
- **One issue, one branch, one PR.** Branch `feat/<issue#>-<slug>` off `main`; PR body
  contains `Closes #<issue>`. Never commit directly to `main`.
- **Incremental commits** at red/green/refactor boundaries — don't squash a story into
  one commit. (They also make recovery free when a session or agent dies mid-work.)
- **No deploys from the CLI.** Deploys are CI-only, triggered by merge to `main`.
  Local verification stops at tests, lint, and synth/build.
- **Docs describe what is.** A doc that has drifted is worse than none, because it is
  trusted: change the doc that owns a behaviour in the same PR that changes the
  behaviour. Superseded documents move to `docs/archive/` with a banner and a pointer —
  never quietly deleted, never silently updated.

## Issue & board hygiene

- **Issues are outstanding work only.** Completed analysis is a document
  (`docs/spikes/`), not a ticket. When converting an analysis into issues, file exactly
  the recommendations actually made — one issue each; fold supporting concerns into an
  issue's acceptance criteria rather than splitting them out. Surface anything else as
  a question, not a filed issue.
- **Every new issue AND PR goes on the project board** with Status kept current, in the
  same pass as filing — filing without boarding is a half-done job.
- **Epics carry real GitHub sub-issues** (the REST `sub_issues` API), attached at epic
  creation. Listing children in a description or comment is not tracking.
- **Closing keywords (`closes/fixes/resolves #N`) live in PR bodies ONLY** — never in
  commit messages (GitHub parses them on the default branch, including inside
  squash-merge bodies). In commits, reference issues as bare `#N`.
- **Milestones** follow a numbered series (`M<n>` / `M<n>.<m>`); closed milestone
  numbers are not reused.

## Design process

- **Spike → rulings → ADR → build.** Novel or architectural questions get a spike
  (written analysis in `docs/spikes/`), which ends in explicit numbered decision
  questions with recommendations. The owner rules on them; rulings are recorded on the
  issue; an ADR encodes the decisions; build issues are cut from the rulings, not
  before.
- **Scope toward the smallest thing that unblocks.** Prefer the minimal shape first;
  defer infrastructure until there's evidence of need. But distinguish *blocked* from
  *lean-backlog deferral* when proposing — completeness is welcome when it's cheap.
- **UX deliberation before build on UI-serving milestones.** If a milestone's features
  will be experienced through an interface, the plan must deliberate how users
  encounter, configure, and see them (placement, constituencies/permissions, management
  surfaces) as an explicit design pass ahead of the machinery — not a UI wave bolted on
  after.
- **Design decisions that are the owner's are never delegated** to agents or defaults.

## Merge & deploy discipline

- **Merges require explicit CI `pass`** — never "not pending" or absence of failure.
  Merge only inside a checks-pass verification, even where branch protection can't
  enforce it.
- **Verify the deploy per merge SHA.** A green PR is not a deployed PR — check the
  deploy run's conclusion for exactly the SHA that merged.
- **Pre-PR local gate suite, run visibly** (no piping that masks exit codes):
  tests · lint · format-check · build · accessibility (if UI) · synth. Keep the list in
  this file current.
- **Combined-tree gates after parallel merges** — cross-PR seams are invisible per-PR;
  run the full suite on the merged tree.
- **Don't stack PRs casually** — GitHub does not retarget a PR to `main` when its base
  branch's PR merges; retarget manually before merging, or avoid stacking.

## Layout

- `docs/` — current documentation; `docs/README.md` is the index.
- `docs/adr/` — architecture decision records, numbered.
- `docs/spikes/` — completed analyses/investigations (the landing place for "issues
  are outstanding work").
- `docs/stories/` — user stories, the backlog's source of truth.
- `docs/archive/` — superseded docs, with banners pointing at successors.
- <Package/app layout for this project.>

## Commands

<The canonical local verification commands, e.g.:>
`uv sync` · `uv run pytest` · `uv run ruff check .` · `uv run ruff format --check .` ·
`<build>` · `<synth>`

## Agent delegation (optional — adopt if running parallel subagent builds)

- Claude subagents only, each in an **isolated git worktree**; verify
  `git worktree list` + current branch at every integration stop.
- **Orchestrator pre-writes the seams before spawning** (shared types, wiring, tokens,
  shared components). Agents consume seams, never edit them; every agent gets an
  explicit owned-file list. Declared co-touched files are allowed — conflicts union at
  the stop.
- Agents follow TDD; no `git push`, no `gh`, no deploys. They leave committed work in
  their worktree.
- **Orchestrator integrates**: reviews every diff against the quality bar, runs the
  full gate suite on the combined tree, owns all PRs/merges and board updates. One
  integration merge at a time.
- **Model tiering, tabled before every wave** (issue | scope | model | why-this-model):
  mid-tier models for pattern-following work protected by CI gates/contract tests;
  top-tier for design/judgment work WITH a named manual review at the stop; frontier
  models sparingly — only novel design/architecture where no gate or review can catch
  a wrong turn (spikes, ADR-shaping).
- Wave prompts never assert derived numbers — tell agents to compute from code/tests.
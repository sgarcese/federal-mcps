# federal-mcps — development conventions

A family of MCP servers that give city and state policy staff federal statistics by
place: BLS first, then Census and CDC PLACES, later HUD, BEA and FEMA, all on one shared
core (geography resolver, HTTP quota and cache discipline, provenance envelope). Read
`docs/architecture.md` before making architectural changes; ADRs live in `docs/adr/`.
This is an independent open-source project in the spirit of OpenContext: permissively
licensed, no dependency on any particular agent platform, usable as a plain connector
from Claude, Claude Code, other MCP hosts, and any agent framework that speaks MCP.

## Ground rules

- **TDD is mandatory.** Write the failing test first; acceptance criteria from the
  GitHub issue become test cases. This applies to infrastructure code (e.g. CDK
  `assertions.Template`) as much as to application packages.
- **One issue, one branch, one PR.** Branch `feat/<issue#>-<slug>` off `main`; PR body
  contains `Closes #<issue>`. Never commit directly to `main`.
- **Incremental commits** at red/green/refactor boundaries — don't squash a story into
  one commit. (They also make recovery free when a session or agent dies mid-work.)
- **No deploys from the CLI.** Deploys are CI-only, triggered by merge to `main`.
  Local verification stops at tests, lint, and synth/build. The single exception is
  the one-time `FederalMcpsCiCd` bootstrap per instance with `AWS_PROFILE=rc-deploy`
  (ADR-004), which creates the OIDC role CI then uses.
- **Docs describe what is.** A doc that has drifted is worse than none, because it is
  trusted: change the doc that owns a behaviour in the same PR that changes the
  behaviour. Superseded documents move to `docs/archive/` with a banner and a pointer —
  never quietly deleted, never silently updated.

## Project-specific rules

- **Agency APIs are never called in unit tests.** Responses are recorded once into
  `fixtures/` and replayed. Live smoke tests run only with `LIVE_TESTS=1` and are a
  separate CI job, never a merge gate.
- **Every tool is read-only** (`readOnlyHint: true`), returns the shared provenance
  envelope from `packages/core`, and uses the family verb set
  (`resolve_place`, `list_indicators`, `get_indicator`, `compare_places`, `get_raw`,
  `describe_source`) where the verb applies. The contract test suite enforces this.
- **Geography is resolved once, in core.** No server ships its own place-name lookup
  or hand-typed FIPS tables; agency-specific codes are columns on the shared catalog.
- **Series and variable IDs are built, not typed.** Each agency package has pure
  builder functions from (geography, measure, industry/occupation) to an ID, each with
  a unit test against a known-good published ID.
- **Numbers carry their caveats.** Preliminary flags, suppression codes, vintage and
  footnotes travel in the envelope; a tool never silently drops them.
- **Quota is a shared resource.** All upstream calls go through the core HTTP client
  (retry, backoff, batching, budget counter). No direct `fetch` to an agency host.

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
  tests · lint · format-check · typecheck · build · contract tests · synth. Keep the
  list in this file current.
- **Combined-tree gates after parallel merges** — cross-PR seams are invisible per-PR;
  run the full suite on the merged tree.
- **Don't stack PRs casually** — GitHub does not retarget a PR to `main` when its base
  branch's PR merges; retarget manually before merging, or avoid stacking.

## Layout

- `docs/` — current documentation; `docs/README.md` is the index.
- `docs/architecture.md` — the family design: shared core, per-agency servers,
  composite endpoint, deployment.
- `docs/adr/` — architecture decision records, numbered.
- `docs/spikes/` — completed analyses/investigations (the landing place for "issues
  are outstanding work").
- `docs/stories/` — user stories, the backlog's source of truth.
- `docs/archive/` — superseded docs, with banners pointing at successors.
- `packages/core/` — shared runtime: geography, HTTP client, envelope, server shell,
  test helpers.
- `packages/geography-build/` — scripts that generate the SQLite geography catalog
  from Census, OMB and agency code tables. Output is a release artifact, not source.
- `packages/server-<agency>/` — one deployable MCP server per agency
  (`server-bls`, `server-census`, `server-cdc-places`, …).
- `packages/server-composite/` — one endpoint that mounts several agency servers with
  prefixed tool names and a single shared `resolve_place`.
- `infra/` — CDK app: one Lambda and route per server, shared secrets, usage plans,
  and the `FederalMcpsCiCd` trust stack.
- `instances.json` — the fleet record (ADR-004); the only place an AWS account or
  region is named.

## Commands

Pre-PR gate suite, run each visibly (same order as the `ci` job):
`npm ci` · `npm run lint` · `npm run format:check` · `npm run typecheck` · `npm test` ·
`npm run test:contract` · `npm run build` · `npm run synth`.
`npm run format` fixes formatting. `npm run geography:build` joins the list when M2 lands.
One-time bootstrap per instance: `docs/runbooks/bootstrap-instance.md`.
The required status check on `main` is the job named `ci`.

## Agent delegation (adopt if running parallel subagent builds)

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

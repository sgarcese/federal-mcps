# Contributing to federal-mcps

Thanks for your interest. This guide gets you set up and explains how we work.
[`CLAUDE.md`](CLAUDE.md) is the authoritative, detailed statement of the conventions;
this is the contributor-facing summary.

## Setup

Requires **Node 22+** (pinned in [`.nvmrc`](.nvmrc)).

```bash
git clone https://github.com/sgarcese/federal-mcps.git
cd federal-mcps
npm ci
npm run build
```

The repo is an npm-workspaces monorepo: shared runtime in `packages/core`, one server per
agency in `packages/server-*`, the catalog builder in `packages/geography-build`.

## The gate suite

Run these before opening a PR — CI runs the same set, and they must all pass:

```bash
npm run lint          # Biome
npm run format:check  # Biome (npm run format fixes)
npm run typecheck     # tsc -b
npm test              # Vitest (unit)
npm run test:contract # family-verb contract suite
npm run build
npm run infra:check   # terraform fmt/validate/test (mocked provider)
```

## How we work

- **TDD is expected.** Write the failing test first; the acceptance criteria on the
  issue become the test cases. This applies to infra (`terraform test`) too.
- **One issue → one branch → one PR.** Branch `feat/<issue#>-<slug>` off `main`; put
  `Closes #<issue>` in the **PR body** (never in commit messages). Commit incrementally.
- **Novel or architectural questions get a spike first.** Written analysis in
  `docs/spikes/` ending in numbered decision questions → the maintainer rules → an ADR in
  `docs/adr/` records it → build issues are cut from the rulings. Don't build a big design
  change without that trail.
- **Docs describe what is.** If you change a behaviour, update the doc that owns it in the
  same PR.

## Project invariants (what reviewers check)

These are the things that make the family coherent — a PR that breaks one won't merge:

- **Family verbs.** Tools use the set `resolve_place`, `list_indicators`, `get_indicator`,
  `compare_places`, `get_raw`, `describe_source` where the verb applies; the contract suite
  enforces this. Every tool is read-only (`readOnlyHint: true`) and returns the shared
  provenance envelope from `packages/core`.
- **Geography is resolved once, in core.** No server ships its own place-name lookup or
  hand-typed FIPS tables; agency codes are columns on the shared catalog.
- **IDs are built, not typed.** Series/variable IDs come from pure builder functions, each
  with a unit test against a known-good published ID.
- **Numbers carry their caveats.** Preliminary/suppression flags, vintage and footnotes
  travel in the envelope; never silently drop or fabricate a value.
- **No direct `fetch` to an agency host.** All upstream calls go through the core HTTP
  client (retry, backoff, batching, budget counter).
- **Agency APIs are never called in unit tests.** Responses are recorded once into
  `fixtures/` and replayed; live smoke tests run only with `LIVE_TESTS=1`.
- **Secrets never enter the repo.** Keys live in a local `.env` (gitignored); `gitleaks`
  runs in CI. Fill in `instances.example.json` → a local `instances.json` (gitignored) for
  deploy config.

## Reporting bugs & proposing features

Open a GitHub issue. For a bug, include repro steps and the expected vs. actual result;
for a feature, describe the policy question it answers by place. Security issues go
through [`SECURITY.md`](SECURITY.md), not public issues.

## License

By contributing, you agree your contributions are licensed under the project's
[Apache-2.0](LICENSE) license. Borrowed code must be compatibly licensed and attributed
in `NOTICE`.

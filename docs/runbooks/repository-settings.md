# Runbook: repository settings (rulesets and security)

The GitHub settings that make `sgarcese/federal-mcps` safe to work on with agents and a single
maintainer (ADR-016 §6). Applied 2026-09-22 with `gh api`; this file is the record, so they can
be inspected and re-applied.

## Rulesets

View: `gh api repos/sgarcese/federal-mcps/rulesets` (each ruleset's id, then
`gh api repos/sgarcese/federal-mcps/rulesets/<id>` for its rules).

### `main: PR + green ci only` (target: branch, `~DEFAULT_BRANCH`, enforcement active, no bypass actors)

| Rule | Setting |
|---|---|
| deletion | the default branch cannot be deleted |
| non_fast_forward | no force-pushes |
| required_linear_history | squash merges keep history linear |
| pull_request | changes land only through a PR; 0 required approvals (single maintainer); stale reviews dismissed on push; review threads must be resolved; allowed merge method: **squash** |
| required_status_checks | the job named **`ci`** must pass; strict (branch must be up to date with `main`) |

Re-apply (idempotent in effect; creates a second ruleset if one exists — delete the old id first):

```sh
gh api -X POST repos/sgarcese/federal-mcps/rulesets --input - <<'JSON'
{ "name": "main: PR + green ci only", "target": "branch", "enforcement": "active", "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true, "require_code_owner_review": false,
        "require_last_push_approval": false, "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false, "required_status_checks": [ { "context": "ci" } ] } } ] }
JSON
```

### `release tags are immutable` (target: tag, `refs/tags/v*`, enforcement active, no bypass actors)

Rules: `deletion`, `non_fast_forward`, `update` — a released tag can be neither moved nor removed.
Cutting a release is unaffected (creating a new `v*` tag is allowed).

```sh
gh api -X POST repos/sgarcese/federal-mcps/rulesets --input - <<'JSON'
{ "name": "release tags are immutable", "target": "tag", "enforcement": "active", "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "update" } ] }
JSON
```

## Repository settings

| Setting | Value | Why |
|---|---|---|
| Merge methods | squash only (`allow_merge_commit=false`, `allow_rebase_merge=false`) | one commit per PR; PR title/body become the commit (`squash_merge_commit_title=PR_TITLE`, `..._message=PR_BODY`) |
| Delete branch on merge | on | no stale `feat/*` branches |
| Secret scanning | enabled | complements gitleaks in `ci` |
| Push protection | enabled | a push containing a known secret pattern is rejected before it lands |
| Dependabot security updates | enabled | PRs for vulnerable dependencies |
| Vulnerability alerts | enabled | |

```sh
gh api -X PATCH repos/sgarcese/federal-mcps -f allow_merge_commit=false -f allow_rebase_merge=false \
  -f allow_squash_merge=true -f delete_branch_on_merge=true \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY
gh api -X PATCH repos/sgarcese/federal-mcps --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},
 "secret_scanning_push_protection":{"status":"enabled"},
 "dependabot_security_updates":{"status":"enabled"}}}
JSON
gh api -X PUT repos/sgarcese/federal-mcps/vulnerability-alerts
```

## What this changes day to day

- `gh pr merge --squash` still works; merges without a green `ci` check are refused by GitHub.
- The maintainer cannot push to `main` directly, even for a one-line fix: open a PR.
- A `v*` tag that was cut wrong is not moved; the next patch version is cut instead.
- The `secret_scanning_non_provider_patterns` and validity checks are left off (noisier; revisit
  if a generic token ever slips past gitleaks).

# ADR-007: Deploy locally under `rc-deploy`, matching the account pattern; no GitHub OIDC role

**Status:** accepted (2026-09-08) · **Supersedes:** ADR-004 §2 and §4, ADR-005 §4, ADR-006 §2 (the CI-role parts) · **Affects:** `terraform/`, `scripts/`, `.github/workflows/`, `instances.json`, the runbook, `CLAUDE.md`

## Context

ADR-004 through ADR-006 assumed CI would assume a per-repository GitHub OIDC role and run
`terraform apply` on merge to `main`. The first real bootstrap proved the Responsive City
account does not support that:

- `rc-deploy` is denied `iam:CreateRole` for the deploy role and `iam:GetOpenIDConnectProvider`
  on the GitHub provider; the provider's existence could not even be confirmed from
  `rc-deploy`. Widening `rc-deploy` needs an administrator, and neither `rc-deploy` nor the
  available SSO permission set has IAM-admin rights.
- The sibling projects in the account (OpenContext's `rc-boulder-co-mcp-prod`,
  `rc-philly-mcp-prod`) deploy by running Terraform **locally** with `rc-deploy`
  credentials. Their CI validates on push and pull request and never applies; their state
  holds Lambda execution roles but no deploy role and no OIDC provider.

The owner ruled on 2026-09-08: match the pattern.

## Decision

1. **Deploys run locally**, under `AWS_PROFILE=rc-deploy`, via `scripts/deploy.sh`:
   build, bundle the Lambda, `terraform init` (backend flags from the fleet record),
   `plan`, `apply`, then verify the live endpoint (`initialize` + `tools/list`, failing
   unless `bls_describe_source` is listed) and print `deployed <sha> to <url>`.
2. **No GitHub OIDC deploy role.** `terraform/modules/github-oidc-deploy-role/` is removed;
   the dev root provisions only the `bls-server` module. `instances.json` drops
   `deployRoleArn`.
3. **CI validates, never deploys.** The `ci` job's existing `terraform fmt`, `validate`,
   `test` and `tflint` steps are the infrastructure gate. `deploy.yml` and its tests are
   removed. This matches OpenContext's `infra.yml`.
4. **`rc-deploy` can already do everything a deploy needs** — create the `rc-bls-mcp-<env>`
   Lambda, its `-role`, the HTTP API, the ACM certificate and Route 53 records, and read
   and write this project's state under `rc/federal-mcps/`. No new permission is required.

## Consequences

- `CLAUDE.md`'s "No deploys from the CLI" rule is amended for this project: the account's
  pattern is a local `rc-deploy` apply, so `scripts/deploy.sh` is the sanctioned deploy
  path and CI is validation-only. The per-merge-SHA verification rule now applies to the
  deploy script's output rather than a CI run.
- A deploy is a deliberate human act, not an automatic consequence of merge. Whoever
  deploys holds `rc-deploy` and runs the script; the printed SHA is the record.
- If push-to-deploy is ever wanted, the named upgrade path is unchanged: an administrator
  creates the GitHub OIDC provider and a deploy role once, after which a workflow can
  assume it. Nothing here forecloses that.

## Alternatives rejected

- **Long-lived `rc-deployer` keys in GitHub secrets** for CI. Rejected: stores standing
  credentials in a repository intended to go public, for no gain over a local apply.
- **Wait for an administrator to create the OIDC role.** Rejected as the default because
  it blocks the first deploy on an action outside the project's control; kept as the
  documented upgrade path.

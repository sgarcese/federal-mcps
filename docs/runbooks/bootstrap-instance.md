# Runbook: deploy an instance

This account deploys **locally**, under `AWS_PROFILE=rc-deploy`, matching the Responsive
City pattern (ADR-007): CI validates every change, a person applies. There is no deploy
role to bootstrap and no state bucket to create — the account's `rc-tfstate-<account>`
bucket already exists, and `rc-deploy` can create everything a server needs
(`rc-<service>-<env>` Lambda, role, HTTP API, ACM certificate, Route 53 records).

## Prerequisites

- `AWS_PROFILE=rc-deploy` (or ambient `rc-deploy` credentials) for the instance's account.
  If SSO-backed, `aws sso login --profile <profile>` first.
- `./.env` with `BLS_API_KEY=<your key>` (gitignored). Register free at
  <https://data.bls.gov/registrationEngine/>.
- The account already has the GitHub Actions OIDC provider only if push-to-deploy is
  later adopted (ADR-007 upgrade path); it is **not** needed for local deploys.

## One-time: the execution role (administrator)

The deploy identity cannot create IAM roles (ADR-007), so an administrator creates the
Lambda's execution role once per instance and lets `rc-deploy` pass it:

```sh
AWS_PROFILE=<admin> scripts/admin-create-exec-role.sh dev
```

That creates `rc-bls-mcp-dev-role` (trust Lambda, inline logs + X-Ray) and grants
`rc-deploy` `iam:PassRole` on it. Idempotent; re-running only updates the policies.

## Deploy

```sh
export AWS_PROFILE=rc-deploy
scripts/deploy.sh dev
```

The script confirms the identity, builds and bundles the Lambda, runs
`terraform init/plan/apply` against `terraform/instances/dev` (backend flags from the
fleet record), then verifies the live endpoint with an MCP `initialize` and `tools/list`
and prints `deployed <sha> to <url>`. That printed line is the per-SHA deploy record
(`CLAUDE.md`, amended by ADR-007).

The BLS key is passed as `TF_VAR_bls_api_key` from `.env` and set on the Lambda as the
`BLS_API_KEY` environment variable (ADR-006 §3). It is stored in Terraform state, in the
private `rc-tfstate` bucket, and never written to the repo.

## First deploy

The first `apply` also creates the ACM certificate and its DNS validation records; the
certificate can take a few minutes to validate, which the script's `curl --retry` in the
verification step is sized for. If the very first verification times out, re-run
`scripts/deploy.sh dev` once DNS has propagated; the apply is idempotent.

## Rotating the key

Update `BLS_API_KEY` in `.env`, then re-run `scripts/deploy.sh dev`. Terraform updates
the Lambda's environment variable in place.

## If a missing OIDC provider ever blocks a future CI upgrade

Local deploys never touch the provider. Push-to-deploy (the ADR-007 upgrade path) would
need an administrator to create the provider (URL
`https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`) and a deploy
role once; that is out of scope for Release 1.

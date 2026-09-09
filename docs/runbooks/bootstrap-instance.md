# Runbook: bootstrap an instance

**This is the single documented exception to "no deploys from the CLI"
(`CLAUDE.md`, ADR-004 §3, ADR-005 §3, ADR-006 §4).** Every other deploy is CI,
triggered by a merge to `main`. A person runs this once per record in `instances.json`,
because the OIDC role GitHub assumes has to exist before GitHub can assume it. Release 1
has one instance, `dev`.

Nothing here needs an administrator: the state bucket already exists in the account
(the Responsive City pattern, ADR-006), and `rc-deploy` can create `rc-*` resources.

Run every step from the repository root with `AWS_PROFILE=rc-deploy` exported.

## 1. Confirm identity

```sh
aws sts get-caller-identity
```

`Account` must equal the instance's `account` in `instances.json`. Stop otherwise.

## 2. Create the deploy role (targeted apply)

```sh
terraform -chdir=terraform/instances/dev init $(node scripts/tf-backend-config.mjs dev)
set -a; source .env; set +a
TF_VAR_bls_api_key="$BLS_API_KEY" \
  terraform -chdir=terraform/instances/dev apply -target=module.github_oidc_deploy_role
```

The backend flags come from the fleet record (`terraform.stateBucket`,
`terraform.stateKey`). The key variable is required by the root even for a targeted
apply of the role; sourcing `.env` supplies it without typing it. The `deploy_role_arn`
output must equal the record's `deployRoleArn`
(`arn:aws:iam::<account>:role/rc-federal-mcps-github-deploy`). If the apply fails on
`iam:GetOpenIDConnectProvider`, the account is missing the GitHub OIDC provider; an
administrator creates it once (URL `https://token.actions.githubusercontent.com`,
audience `sts.amazonaws.com`).

## 3. Give CI the agency key

The key is a repository secret, never a file in the repo. From `.env`:

```sh
gh secret set BLS_API_KEY --body "$BLS_API_KEY"
```

`deploy.yml` passes it to Terraform as `TF_VAR_bls_api_key`; Terraform sets it on the
Lambda as the `BLS_API_KEY` environment variable and stores it in state (ADR-006 §3).

## 4. Turn on CI deploys

```sh
gh variable set FEDERAL_MCPS_DEPLOY_ENABLED --body true
```

`deploy.yml` skips its job until this repository variable is `true`, so merges before
the bootstrap do not produce failed deploy runs.

## Done

CI now assumes `rc-federal-mcps-github-deploy` on every merge to `main` and runs
`terraform apply` for the whole instance root. Re-running this runbook is safe; every
step is idempotent. To rotate the key: update `.env`, rerun step 3, and merge anything
to `main` (or re-run the last deploy).

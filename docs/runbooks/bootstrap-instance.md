# Runbook: bootstrap an instance

**This is the single documented exception to "no deploys from the CLI"
(`CLAUDE.md`, ADR-004 §3, ADR-005 §3).** Every other deploy is CI, triggered by a
merge to `main`. A person runs this once per record in `instances.json`, because two
things must exist before CI can deploy: the Terraform state bucket, and the OIDC role
GitHub assumes. Release 1 has one instance, `dev`.

Run every step from the repository root with `AWS_PROFILE=rc-deploy` exported.

## 1. Confirm identity

```sh
aws sts get-caller-identity
```

`Account` must equal the instance's `account` in `instances.json`. Stop otherwise.

## 2. Create the state bucket (`terraform/bootstrap`, local state)

```sh
node scripts/tf-backend-config.mjs dev --bootstrap-vars > terraform/bootstrap/dev.auto.tfvars.json
terraform -chdir=terraform/bootstrap init
terraform -chdir=terraform/bootstrap apply
```

Keep `terraform/bootstrap/terraform.tfstate` and the generated tfvars out of git (both
are ignored). The bucket is `federal-mcps-tfstate-<account>`, versioned, with S3 native
locking, so nothing else is needed for state.

## 3. Create the deploy role (`terraform/instances/dev`, targeted apply)

```sh
terraform -chdir=terraform/instances/dev init $(node scripts/tf-backend-config.mjs dev)
terraform -chdir=terraform/instances/dev apply -target=module.github_oidc_deploy_role
```

The `deploy_role_arn` output must equal the record's `deployRoleArn`
(`arn:aws:iam::<account>:role/federal-mcps-github-deploy`). If the apply fails on
`iam:GetOpenIDConnectProvider`, the account is missing the GitHub OIDC provider; an
admin creates it once (URL `https://token.actions.githubusercontent.com`, audience
`sts.amazonaws.com`).

## 4. Create the agency secret

Terraform never creates or reads secret values (ADR-004 §6). The value comes from your
local `.env`, which is gitignored:

```sh
set -a; source .env; set +a
aws secretsmanager create-secret --name federal-mcps/dev/bls \
  --secret-string "{\"BLS_API_KEY\":\"$BLS_API_KEY\"}"
```

The name must match the record's `secrets.bls`.

## Done

CI (`deploy.yml`, #10) now assumes `federal-mcps-github-deploy` on every merge to `main`
and runs `terraform apply` for the whole instance root. Re-running this runbook is safe:
every step is idempotent except `create-secret`, which errors if the secret exists
(use `put-secret-value` to rotate).

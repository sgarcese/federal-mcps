# ADR-005: Infrastructure is Terraform, with an S3 state backend created in the bootstrap

**Status:** accepted (2026-09-08) · **Supersedes:** ADR-002 §3 (tooling only), ADR-004 §2–3 (how the role is created; what the bootstrap creates) · **Affects:** `terraform/`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `docs/runbooks/bootstrap-instance.md`

> **Superseded in part by ADR-007 (2026-09-08):** §4 (Terraform apply from a CI deploy
> workflow) no longer applies — deploys run locally via `scripts/deploy.sh`.

## Context

ADR-002 chose CDK for infrastructure and #11 shipped the GitHub OIDC trust stack in CDK.
Before any further infrastructure was built, the owner ruled on 2026-09-08 that the
project uses Terraform, matching OpenContext and the owner's other deployments. The
cost of switching at this point is one small rewrite; the cost of switching after the
BLS server stack and deploy workflow exist would be three.

## Decision

1. **Terraform ≥ 1.10, `hashicorp/aws` provider pinned exactly**, in a `terraform/` tree:
   - *(Amended by ADR-006 §1: no bootstrap bucket; state lives in the account's
     pre-existing `rc-tfstate-<account>` under `rc/federal-mcps/<instance>/`.)*
     Locking uses S3's native lockfile (`use_lockfile = true`); no DynamoDB.
   - `terraform/modules/github-oidc-deploy-role/` — the deploy role from ADR-004 §2,
     with the permissions `terraform apply` needs for the BLS server stack in place of
     CDK's `sts:AssumeRole` on `cdk-*`. It reads the account's existing OIDC provider
     through a data source and never creates one.
   - `terraform/modules/bls-server/` (#9) — Lambda, HTTP API, custom domain, secret
     access.
   - `terraform/instances/<name>/` — one root module per fleet-record instance, with
     the S3 backend and the provider. It reads `instances.json` with `jsondecode` and
     selects its record by name, so `instances.json` stays the only place an account,
     region, zone or domain is written.
2. **Tests are Terraform-native.** `terraform test` with `mock_provider "aws"` asserts
   the trust policy, the permission set, outputs and the absence of forbidden resources.
   `terraform fmt -check`, `terraform validate` and tflint are CI gates. A Vitest test
   greps `terraform/` for the account id, zone id and domain and fails if any appear
   outside `instances.json`.
3. **The bootstrap runbook** *(amended by ADR-006 §4: one targeted apply, no bucket)*:
   `terraform/instances/<name>` limited to the deploy-role module
   (`-target=module.github_oidc_deploy_role`), both by a person with
   `AWS_PROFILE=rc-deploy`. Everything after that is CI. ADR-004 §3's "single exception"
   wording stands; it is one runbook, run once per instance.
4. **The deploy workflow (#10)** runs `terraform init` / `plan -out` / `apply` in the
   instance root after assuming the OIDC role, and keeps ADR-004 §4's shape otherwise.
5. **The instance record loader** moves from CDK code to `scripts/instance.mjs`, used by
   the workflow's first step and by tests; the concurrency-group rule from ADR-004 §4 is
   asserted against that script.

## Consequences

- `infra/` (CDK) is deleted; `aws-cdk-lib`, `aws-cdk`, `constructs` and `tsx` leave the
  dependency tree. A note in `docs/archive/` points at the commit that carried it.
- Terraform state is a real resource with a real bucket; the bootstrap must exist before
  the first CI deploy. Losing the bucket loses the state; versioning is on for that reason.
- IAM permissions for the deploy role are broader than CDK's single assume-role, because
  Terraform applies directly. They are scoped to `federal-mcps-*` and `FederalMcps*`
  names where the service supports resource-level scoping and documented where it
  doesn't (API Gateway, ACM).

## Alternatives rejected

- **Keep CDK.** Rejected by the owner; the team's other infrastructure is Terraform.
- **DynamoDB lock table.** Unnecessary since Terraform 1.10's S3 lockfile; one less
  resource to bootstrap and pay for.
- **Terraform Cloud / remote runs.** No need for a second control plane; GitHub OIDC to
  AWS already exists.

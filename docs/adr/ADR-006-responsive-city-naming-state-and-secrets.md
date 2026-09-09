# ADR-006: Follow the Responsive City account pattern — `rc-*` names, the shared state bucket, keys as Terraform variables

**Status:** accepted (2026-09-08) · **Amends:** ADR-004 §2, §6; ADR-005 §1, §3 · **Affects:** `instances.json`, `terraform/`, `scripts/`, `.github/workflows/deploy.yml`, the bootstrap runbook

## Context

The first bootstrap attempt under `AWS_PROFILE=rc-deploy` failed on `s3:CreateBucket`.
Read-only probing of the account, and the resource lists of the two Terraform projects
`rc-deploy` has already applied there, showed what the Responsive City pattern actually
is:

- Terraform state lives in the pre-existing bucket `rc-tfstate-<account>`, one key per
  project under `rc/<project>/…`. `rc-deploy` can list, read and write it.
- Every resource is named `rc-<service>-<env>` (`rc-boulder-co-mcp-prod`,
  `rc-philly-mcp-prod-role`, `rc-…-api`, log groups under the same names).
  `rc-deploy` can read `rc-*` roles and functions and is denied on everything else: its
  permissions are scoped to that prefix, which is why our `federal-mcps-*` names failed.
- Hostnames are `<service>.responsive.city` with ACM and Route 53 in the fleet zone.
- The account grants `rc-deploy` nothing in Secrets Manager, SSM or KMS. Sibling Lambdas
  receive configuration through environment variables set by Terraform.
- The only other identity available (the LS SSO permission set) is also a deploy role
  without IAM rights, so widening `rc-deploy` would need an administrator who is not
  on hand.

The owner's ruling: follow the pattern, and accept that the agency API keys live in
Terraform state in the private bucket rather than in Secrets Manager.

## Decision

1. **State:** the dev root uses `rc-tfstate-<account>` with key
   `rc/federal-mcps/<instance>/terraform.tfstate`, both read from the fleet record
   (`terraform.stateBucket`, `terraform.stateKey`) and passed at `terraform init`. No
   bootstrap bucket; `terraform/bootstrap/` is removed.
2. **Names:** the BLS server is `rc-bls-mcp-<env>` (function, `-role`, `-api`, log
   groups); the CI role is `rc-federal-mcps-github-deploy`; every future server follows
   `rc-<service>-mcp-<env>`. The deploy role's own permissions are scoped to `rc-*`.
3. **Secrets:** agency keys are `sensitive` Terraform variables set on the Lambda as
   environment variables (`BLS_API_KEY`). CI supplies them as `TF_VAR_bls_api_key`
   from a GitHub repository secret; the person running the bootstrap supplies it from
   `.env`. The value therefore exists in Terraform state, in a bucket readable only by
   `rc-deploy` and the CI role. ADR-004 §6 (Secrets Manager) is withdrawn.
4. **Bootstrap:** two commands under `rc-deploy` — `terraform init` against the existing
   bucket and a targeted apply of the OIDC role — then the GitHub secret and the deploy
   gate variable. No administrator step; the temporary grant from #32–#34 is removed.

## Why the secret tradeoff is acceptable here

- The keys are low value: free registration, rate-limit only, replaceable in a minute.
  A leak costs someone our daily quota.
- Terraform state holds sensitive values in plaintext regardless of where the secret
  lives; with Secrets Manager the reader would have been the same identity one API call
  away. The real boundary is who can assume `rc-deploy` or the CI role, and that is
  unchanged.
- The pattern is what the account already runs; the alternative needs an administrator
  and adds a service nobody else in the account uses.

Conditions: the variable is `sensitive` so plans and CI logs redact it; the bucket stays
private and versioned; rotate the key if the `rc-deployer` access keys are ever exposed;
revisit the moment a high-value secret (a paid API, database credentials) enters the
family.

## Consequences

- `instances.json` gains a `terraform` block and loses `secrets`; the loader, the
  backend-config helper and the literal-scan test change accordingly.
- Issues #32–#34's grant policy and runbook steps 0 and 6 are deleted; they solved the
  wrong problem.
- Renaming after a first deploy would replace resources; this ADR lands before any
  resource exists.

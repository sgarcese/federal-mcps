# ADR-004: Deploy to the Responsive City AWS account using the fleet-record pattern

**Status:** accepted (2026-09-08) · **Refines:** ADR-002 §3 · **Affects:** `instances.json`, `infra/`, `.github/workflows/deploy.yml`, `CLAUDE.md`

## Context

ADR-002 chose one Lambda per server behind an HTTP API, deployed from CI. It left the
account and the trust mechanics open. The owner ruled on 2026-09-08 that the project
deploys to the Responsive City AWS account using the same pattern as their other
deployments there, bootstrapped through the `rc-deploy` profile.

Facts verified read-only from that profile: account `123456789012`, region `us-east-1`,
a `responsive.city` public hosted zone (`Z02890412WHZ405FIOT0Y`), an existing CDK
bootstrap (`CDKToolkit` stack present), and a GitHub OIDC provider already registered in
the account (referenced, not created, by sibling deployments). The `rc-deploy` role is
narrowly scoped: it can assume roles and deploy through the CDK bootstrap roles but
cannot list IAM or CloudFormation resources.

## Decision

1. **The fleet record names the deployment.** A committed `instances.json` at the repo
   root holds one record per instance (`name`, `account`, `region`, `environmentTag`,
   `deployRoleArn`, `domain`). Nothing else in the repository names an account or
   region; CDK and the deploy workflow read the record. Release 1 commits one instance,
   `dev`.
2. **GitHub deploys through OIDC, never with stored keys.** An `infra` stack
   `FederalMcpsCiCd` references the account's existing OIDC provider and creates
   `federal-mcps-github-deploy`, assumable only by this repository's `main` branch using
   the ID-qualified subject `repo:sgarcese@2701478/federal-mcps@1361995308:ref:refs/heads/main`
   (immutable across renames). Its only permission is `sts:AssumeRole` on
   `arn:aws:iam::123456789012:role/cdk-*`, plus the read-only calls the post-deploy
   verification step needs, scoped to `FederalMcps*` stacks and functions.
3. **One human bootstrap, then CI only.** The CI/CD stack is deployed exactly once by a
   person using `AWS_PROFILE=rc-deploy`, because the OIDC role must exist before GitHub
   can assume it. That bootstrap is the single documented exception to "no deploys from
   the CLI" in `CLAUDE.md`; every other deploy is a merge to `main`.
4. **Deploy workflow shape** mirrors the sibling pattern: `push` to `main`, docs-only
   changes skipped by path filter, `permissions: id-token: write`, a first step that
   resolves the instance record with `jq`, `aws-actions/configure-aws-credentials`
   assuming `deployRoleArn`, `cdk deploy --all --require-approval never`, then a
   post-deploy check that POSTs `initialize` and `tools/list` to the live URL and fails
   the job if `bls_describe_source` is absent. Concurrency group `deploy-dev`, no
   cancel-in-progress.
5. **Custom domain.** One hostname per server, following the sibling deployments'
   `<service>.responsive.city` pattern: `bls-mcp.responsive.city` in Release 1, with
   the MCP endpoint at `/mcp`. Later servers get their own hostnames on the same
   pattern, named when they ship. Each server stack creates its own ACM certificate
   in `us-east-1` and Route 53 alias in the existing zone from the fleet record's
   `domain` field, so a server can be added or removed without touching another's DNS.
6. **Secrets.** `BLS_API_KEY` lives in Secrets Manager under `federal-mcps/dev/bls`;
   the Lambda role may read exactly that ARN. The secret value is created by a person
   with `rc-deploy`, not by CDK, so it never passes through a template.

## Consequences

- Adding a stage or a second account is adding a record to `instances.json` and
  running the bootstrap once in that account.
- The account id and hosted zone id are committed. They are not secrets; the sibling
  deployment already commits them, and the repository may go public.
- Issue #10 (deploy workflow) is unblocked for design but still requires the one-time
  bootstrap to be run by the owner before its post-deploy check can pass.

## Alternatives rejected

- **Long-lived IAM user keys in GitHub secrets.** Rejected for the usual reasons; the
  account already has the OIDC provider.
- **One domain with a path per server** (`mcp.responsive.city/bls/mcp`). Rejected by
  the owner in favor of the established one-hostname-per-service pattern; independent
  hostnames also keep each server's certificate and DNS independent of the others.

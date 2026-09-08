# Runbook: bootstrap a new instance's `FederalMcpsCiCd` stack

**This is the single documented exception to "no deploys from the CLI"
(`CLAUDE.md`, ADR-004 §3).** Every other deploy is CI-only, triggered by a
merge to `main`. This runbook exists because the OIDC role GitHub Actions
assumes has to exist before GitHub can assume it — a human has to create it
once, per instance, with real AWS credentials.

Run every step below with `AWS_PROFILE=rc-deploy` set. Do this once per
instance record in `instances.json` (Release 1 has one: `dev`).

## 1. Confirm identity

```sh
AWS_PROFILE=rc-deploy aws sts get-caller-identity
```

Confirm the `Account` in the output matches the instance's `account` field in
`instances.json` (`564762345093` for `dev`). Stop and fix your profile if it
doesn't.

## 2. Confirm the CDK bootstrap exists

```sh
AWS_PROFILE=rc-deploy aws cloudformation describe-stacks --stack-name CDKToolkit
```

ADR-004 records that the `dev` account already has a `CDKToolkit` stack. The
`rc-deploy` role is narrowly scoped (it can assume roles and deploy through
the CDK bootstrap roles, but cannot list IAM or CloudFormation resources), so
this call may fail with an access-denied error even when the bootstrap is
fine. **A failure here is not proof the bootstrap is missing** — if it fails,
ask an admin to confirm the `CDKToolkit` stack exists in the target account
and region before continuing; do not run `cdk bootstrap` speculatively.

## 3. Build and synth

From the repository root:

```sh
npm ci
npm run synth
```

This must exit 0 and produce `infra/cdk.out/FederalMcpsCiCd.template.json`.

## 4. Deploy the stack

```sh
cd infra
AWS_PROFILE=rc-deploy npx aws-cdk@2 deploy FederalMcpsCiCd --require-approval never
```

Note the `DeployRoleArn` output CDK prints at the end — you'll check it
against `instances.json` in step 6.

## 5. Create the agency secret

CDK never creates or touches secret values (ADR-004 §6) — the Lambda role is
scoped to read exactly one ARN, but the value is created by a person:

```sh
AWS_PROFILE=rc-deploy aws secretsmanager create-secret \
  --name federal-mcps/dev/bls \
  --secret-string '{"BLS_API_KEY":"..."}'
```

Replace `dev` with the instance name and `...` with the real BLS API key.
The secret name must match the instance record's `secrets.bls` field in
`instances.json`.

## 6. Verify the role ARN matches the fleet record

```sh
AWS_PROFILE=rc-deploy aws iam get-role \
  --role-name federal-mcps-github-deploy \
  --query 'Role.Arn' --output text
```

`rc-deploy` is denied most IAM reads, so this call may fail with access denied;
in that case use the `DeployRoleArn` output CDK printed in step 4 instead.
Confirm the ARN equals the `deployRoleArn` field of the instance's record in
`instances.json`. If it doesn't, something is wrong with the account/instance
mapping — stop and investigate before merging any workflow that assumes this
role.

## Done

Once this runbook has run for an instance, `.github/workflows/deploy.yml`
(issue #10) can assume `federal-mcps-github-deploy` through OIDC on every
merge to `main` — no further CLI deploys are needed for that instance.

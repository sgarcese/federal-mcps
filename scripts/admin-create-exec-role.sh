#!/usr/bin/env bash
# Create the Lambda execution role for one instance, and let rc-deploy pass it.
#
# Run ONCE per instance AND SERVER by an ADMINISTRATOR (root or an IAM-admin
# identity), because the deploy identity (rc-deploy) cannot create IAM roles in
# this account (ADR-007). Everything after this is a normal `scripts/deploy.sh`.
#
#   AWS_PROFILE=<admin> scripts/admin-create-exec-role.sh [instance] [server]
#     instance  fleet-record name          (default: dev)
#     server    bls | geo | census | cdc    (default: bls)
#
# Each server (bls, geo, census) is a separate Lambda with its own execution role, so run
# this once per server: e.g. `... dev bls` and `... dev geo`.
#
# It is idempotent: re-running updates the inline policies in place.
#
# What it creates, all derived from instances.json (nothing hardcoded):
#   - role  <service>-<env>-role         trust: lambda.amazonaws.com
#       inline policy "logs-and-xray":   write this Lambda's log group + X-Ray
#   - inline policy on the rc-deploy role granting iam:PassRole on the new role,
#     so the deployer can attach it to the Lambda.
set -euo pipefail
cd "$(dirname "$0")/.."

INSTANCE="${1:-dev}"
SERVER="${2:-bls}"
case "$SERVER" in
  bls | geo | census | cdc) ;;
  *) echo "::error:: unknown server '${SERVER}' (expected: bls | geo | census | cdc)"; exit 1 ;;
esac

read -r ACCOUNT REGION SERVICE ENVTAG DEPLOY_ROLE < <(
  FEDERAL_MCPS_INSTANCE="$INSTANCE" SERVER="$SERVER" node --input-type=module -e '
    import { selectInstance } from "./scripts/instance.mjs";
    const i = selectInstance();
    const service =
      process.env.SERVER === "geo"
        ? i.naming.geoService
        : process.env.SERVER === "census"
          ? i.naming.censusService
          : process.env.SERVER === "cdc"
            ? i.naming.cdcService
            : i.naming.blsService;
    const deployRole = "rc-deploy"; // the role scripts/deploy.sh assumes
    // Trailing newline is required: `read` returns non-zero on EOF without one,
    // which `set -euo pipefail` would turn into a silent exit before any output (#90).
    process.stdout.write(`${[i.account, i.region, service, i.environmentTag, deployRole].join(" ")}\n`);
  '
)

ROLE="${SERVICE}-${ENVTAG}-role"                 # e.g. rc-bls-mcp-dev-role
FUNCTION="${SERVICE}-${ENVTAG}"                  # e.g. rc-bls-mcp-dev
LOG_GROUP_ARN="arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/aws/lambda/${FUNCTION}"
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE}"

echo "== admin identity"
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json
echo "instance=${INSTANCE} server=${SERVER} account=${ACCOUNT} role=${ROLE} function=${FUNCTION}"

TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

echo "== create (or confirm) the execution role"
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "role ${ROLE} already exists — updating its trust and policy"
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"
else
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document "$TRUST" \
    --description "Execution role for the ${FUNCTION} Lambda (federal-mcps, ADR-007)" \
    --tags Key=project,Value=federal-mcps Key=environment,Value="${ENVTAG}" >/dev/null
  echo "created ${ROLE}"
fi

echo "== inline policy: logs on the Lambda's own log group + X-Ray"
EXEC_POLICY=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
  {"Sid":"WriteOwnLogGroup","Effect":"Allow",
   "Action":["logs:CreateLogStream","logs:PutLogEvents","logs:CreateLogGroup"],
   "Resource":["${LOG_GROUP_ARN}","${LOG_GROUP_ARN}:*"]},
  {"Sid":"XRayTracing","Effect":"Allow",
   "Action":["xray:PutTraceSegments","xray:PutTelemetryRecords"],
   "Resource":["*"]}
]}
JSON
)
aws iam put-role-policy --role-name "$ROLE" --policy-name logs-and-xray --policy-document "$EXEC_POLICY"

echo "== grant rc-deploy iam:PassRole on ${ROLE}"
PASS_POLICY=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
  {"Sid":"PassExecRole","Effect":"Allow","Action":"iam:PassRole","Resource":"${ROLE_ARN}"}
]}
JSON
)
aws iam put-role-policy --role-name "$DEPLOY_ROLE" \
  --policy-name "federal-mcps-passrole-${FUNCTION}" --policy-document "$PASS_POLICY"

echo
echo "done. ${ROLE} exists and rc-deploy may pass it."
echo "Now deploy: AWS_PROFILE=rc-deploy scripts/deploy.sh ${INSTANCE}"

#!/usr/bin/env bash
# Grant what M17's public-use limiter needs, once per instance (#320, ADR-020 §10).
#
# Run ONCE per instance by an ADMINISTRATOR (root or an IAM-admin identity), never by an
# agent and never by rc-deploy (ADR-007: the deploy identity cannot create IAM resources
# or a DynamoDB table in this account). After this runs, `scripts/deploy.sh` and the
# Terraform monitoring module can proceed on their own.
#
#   AWS_PROFILE=<admin> scripts/admin-grant-protection.sh [instance] [--dry-run]
#     instance   fleet-record name (default: dev)
#     --dry-run  print every AWS call and policy document; call nothing
#
# It is idempotent: re-running updates the inline policies and table settings in place and
# skips table creation if the table already exists.
#
# What it does, all derived from instances.json (nothing hardcoded):
#   1. Creates the on-demand DynamoDB table rc-federal-mcps-<env>-limits (pk: S, TTL on
#      expiresAt) if it does not already exist.
#   2. Grants each non-CDC server's execution role (bls, census, hud, bea, geo) an inline
#      policy allowing dynamodb:UpdateItem and dynamodb:GetItem on that table's ARN only.
#      The CDC OpenContext portal has no execution-role grant (ADR-020 §2: core's in-app
#      layer does not reach OpenContext).
#   3. Grants rc-deploy the CloudWatch (dashboards, alarms), SNS and Budgets rights the
#      coming monitoring module needs, scoped to rc-* names wherever the service supports
#      resource-level scoping, as an inline policy next to its existing PassRole grants.
#   4. Activates the "project" cost-allocation tag.
#   5. Reports the account's Lambda concurrency limit and unreserved amount, and warns if
#      reserving ADR-020's default reserved concurrency (5 each for bls, census, geo and
#      the CDC portal; 2 each for HUD and BEA — 24 total) would leave fewer than 100
#      unreserved.
set -euo pipefail
cd "$(dirname "$0")/.."

INSTANCE="dev"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) INSTANCE="$arg" ;;
  esac
done

# Reserved concurrency defaults from ADR-020 §6, used only to size the warning in step 5.
RESERVED_BLS=5
RESERVED_CENSUS=5
RESERVED_GEO=5
RESERVED_CDC=5
RESERVED_HUD=2
RESERVED_BEA=2
RESERVED_TOTAL=$((RESERVED_BLS + RESERVED_CENSUS + RESERVED_GEO + RESERVED_CDC + RESERVED_HUD + RESERVED_BEA))
MIN_UNRESERVED=100

read -r ACCOUNT REGION ENVTAG DEPLOY_ROLE \
  BLS_SERVICE CENSUS_SERVICE GEO_SERVICE HUD_SERVICE BEA_SERVICE < <(
  FEDERAL_MCPS_INSTANCE="$INSTANCE" node --input-type=module -e '
    import { selectInstance } from "./scripts/instance.mjs";
    const i = selectInstance();
    const deployRole = "rc-deploy"; // the role scripts/deploy.sh assumes
    // Trailing newline required: `read` returns non-zero on EOF without one, which
    // `set -euo pipefail` would turn into a silent exit before any output (#90).
    process.stdout.write(
      [
        i.account,
        i.region,
        i.environmentTag,
        deployRole,
        i.naming.blsService,
        i.naming.censusService,
        i.naming.geoService,
        i.naming.hudService,
        i.naming.beaService,
      ].join(" ") + "\n",
    );
  '
)

TABLE="rc-federal-mcps-${ENVTAG}-limits"
TABLE_ARN="arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}"

# role names, derived exactly as admin-create-exec-role.sh derives them
BLS_ROLE="${BLS_SERVICE}-${ENVTAG}-role"
CENSUS_ROLE="${CENSUS_SERVICE}-${ENVTAG}-role"
GEO_ROLE="${GEO_SERVICE}-${ENVTAG}-role"
HUD_ROLE="${HUD_SERVICE}-${ENVTAG}-role"
BEA_ROLE="${BEA_SERVICE}-${ENVTAG}-role"
# Deliberately not computed/used: the CDC portal's role gets no grant from this script.

echo "== admin identity"
if [ "$DRY_RUN" = 1 ]; then
  echo "DRY RUN -- aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json"
else
  aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json
fi
echo "instance=${INSTANCE} account=${ACCOUNT} region=${REGION} table=${TABLE}"

run_aws() {
  if [ "$DRY_RUN" = 1 ]; then
    echo "DRY RUN -- aws $*"
  else
    aws "$@"
  fi
}

echo
echo "== step 1: the limits table (${TABLE})"
if [ "$DRY_RUN" = 1 ]; then
  run_aws dynamodb create-table \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --tags Key=project,Value=federal-mcps Key=environment,Value="${ENVTAG}"
  run_aws dynamodb update-time-to-live \
    --table-name "$TABLE" \
    --time-to-live-specification Enabled=true,AttributeName=expiresAt
else
  if aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
    echo "table ${TABLE} already exists — leaving it in place"
  else
    aws dynamodb create-table \
      --table-name "$TABLE" \
      --attribute-definitions AttributeName=pk,AttributeType=S \
      --key-schema AttributeName=pk,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST \
      --tags Key=project,Value=federal-mcps Key=environment,Value="${ENVTAG}" >/dev/null
    aws dynamodb wait table-exists --table-name "$TABLE"
    echo "created ${TABLE}"
  fi
  aws dynamodb update-time-to-live \
    --table-name "$TABLE" \
    --time-to-live-specification Enabled=true,AttributeName=expiresAt >/dev/null 2>&1 || true
fi

echo
echo "== step 2: per-role DynamoDB grant on ${TABLE} (bls, census, hud, bea, geo — not cdc)"
limits_policy_for_table() {
  cat <<JSON
{"Version":"2012-10-17","Statement":[
  {"Sid":"FederalMcpsLimitsTable","Effect":"Allow",
   "Action":["dynamodb:UpdateItem","dynamodb:GetItem"],
   "Resource":"${TABLE_ARN}"}
]}
JSON
}
LIMITS_POLICY="$(limits_policy_for_table)"

for role in "$BLS_ROLE" "$CENSUS_ROLE" "$HUD_ROLE" "$BEA_ROLE" "$GEO_ROLE"; do
  echo "-- ${role}"
  run_aws iam put-role-policy --role-name "$role" \
    --policy-name federal-mcps-limits-table --policy-document "$LIMITS_POLICY"
done

echo
echo "== step 3: rc-deploy — CloudWatch, SNS and Budgets rights for the monitoring module"
DASHBOARD_ARN="arn:aws:cloudwatch::${ACCOUNT}:dashboard/rc-*"
ALARM_ARN="arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:rc-*"
SNS_ARN="arn:aws:sns:${REGION}:${ACCOUNT}:rc-*"
BUDGET_ARN="arn:aws:budgets::${ACCOUNT}:budget/rc-*"

MONITORING_POLICY=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
  {"Sid":"CloudWatchAlarmsOnRcNames","Effect":"Allow",
   "Action":["cloudwatch:PutMetricAlarm","cloudwatch:DeleteAlarms","cloudwatch:TagResource"],
   "Resource":"${ALARM_ARN}"},
  {"Sid":"CloudWatchDescribeNotResourceScopable","Effect":"Allow",
   "Action":["cloudwatch:DescribeAlarms","cloudwatch:DescribeAlarmsForMetric","cloudwatch:ListTagsForResource"],
   "Resource":"*"},
  {"Sid":"CloudWatchDashboardsOnRcNames","Effect":"Allow",
   "Action":["cloudwatch:GetDashboard","cloudwatch:PutDashboard","cloudwatch:DeleteDashboards"],
   "Resource":"${DASHBOARD_ARN}"},
  {"Sid":"SnsTopicsOnRcNames","Effect":"Allow",
   "Action":["sns:CreateTopic","sns:DeleteTopic","sns:Subscribe","sns:Unsubscribe",
             "sns:GetTopicAttributes","sns:SetTopicAttributes","sns:TagResource"],
   "Resource":"${SNS_ARN}"},
  {"Sid":"BudgetsOnRcNames","Effect":"Allow",
   "Action":["budgets:ModifyBudget","budgets:ViewBudget"],
   "Resource":"${BUDGET_ARN}"}
]}
JSON
)

run_aws iam put-role-policy --role-name "$DEPLOY_ROLE" \
  --policy-name federal-mcps-monitoring --policy-document "$MONITORING_POLICY"

echo
echo "== step 4: activate the project cost-allocation tag"
run_aws ce update-cost-allocation-tags-status \
  --cost-allocation-tags-status '[{"TagKey":"project","Status":"Active"}]'

echo
echo "== step 5: Lambda account concurrency"
if [ "$DRY_RUN" = 1 ]; then
  run_aws lambda get-account-settings
  echo "(dry run: would compute, from the real response, AccountLimit.UnreservedConcurrentExecutions"
  echo " minus ${RESERVED_TOTAL} (ADR-020 defaults: ${RESERVED_BLS}+${RESERVED_CENSUS}+${RESERVED_GEO}+${RESERVED_CDC}+${RESERVED_HUD}+${RESERVED_BEA}),"
  echo " and warn if that would leave fewer than ${MIN_UNRESERVED} unreserved)"
else
  SETTINGS_JSON="$(aws lambda get-account-settings)"
  echo "$SETTINGS_JSON" | node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    const data = JSON.parse(readFileSync(0, 'utf-8'));
    const limit = data.AccountLimit?.ConcurrentExecutions;
    const unreserved = data.AccountLimit?.UnreservedConcurrentExecutions;
    console.log(\`account concurrency limit: \${limit}\`);
    console.log(\`unreserved today: \${unreserved}\`);
    const afterReserving = unreserved - ${RESERVED_TOTAL};
    console.log(\`unreserved after reserving ADR-020 defaults (${RESERVED_TOTAL} total): \${afterReserving}\`);
    if (afterReserving < ${MIN_UNRESERVED}) {
      console.log(\`::warning:: only \${afterReserving} would remain unreserved (below ${MIN_UNRESERVED}) — \` +
        'review the defaults before scripts/deploy.sh sets reserved concurrency.');
    }
  "
fi

echo
echo "done. ${TABLE} is ready, bls/census/hud/bea/geo roles can read/update it, rc-deploy has"
echo "monitoring rights on rc-* names, the project tag is active, and concurrency is reported above."

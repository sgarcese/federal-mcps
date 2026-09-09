#!/usr/bin/env bash
# Deploy one instance of federal-mcps, locally, matching the Responsive City
# account pattern (ADR-007). This is the sanctioned deploy path: CI validates,
# a person applies.
#
#   AWS_PROFILE=rc-deploy scripts/deploy.sh [instance]   # default instance: dev
#
# Requirements:
#   - AWS_PROFILE (or ambient credentials) for an rc-deploy session in the
#     instance's account.
#   - The BLS API key in ./.env as BLS_API_KEY (gitignored). It becomes
#     TF_VAR_bls_api_key and is set on the Lambda as an environment variable
#     (ADR-006 §3); it is never written to the repo.
#   - The instance's Terraform state bucket already exists in the account
#     (the pre-existing rc-tfstate bucket; ADR-006 §1).
set -euo pipefail
cd "$(dirname "$0")/.."

INSTANCE="${1:-dev}"
export FEDERAL_MCPS_INSTANCE="$INSTANCE"
ROOT="terraform/instances/${INSTANCE}"
[ -d "$ROOT" ] || { echo "::error:: unknown instance '${INSTANCE}' (no ${ROOT})"; exit 1; }

if [ -z "${BLS_API_KEY:-}" ]; then
  [ -f .env ] || { echo "::error:: BLS_API_KEY not set and no .env present"; exit 1; }
  set -a; # shellcheck disable=SC1091
  source .env; set +a
fi
[ -n "${BLS_API_KEY:-}" ] || { echo "::error:: BLS_API_KEY is empty"; exit 1; }
export TF_VAR_bls_api_key="$BLS_API_KEY"

echo "== identity"
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json

echo "== build + bundle"
npm ci
npm run build
npm run bundle -w packages/server-bls

# The geography Lambda bakes the catalog into its zip (ADR-008 §7). Build the catalog
# artifact once if it is not already present (it is release data, not rebuilt per deploy;
# delete packages/geography-build/dist or set GEO_CATALOG_ARTIFACT to force a refresh).
if [ -z "${GEO_CATALOG_ARTIFACT:-}" ] && ! ls packages/geography-build/dist/geo-catalog@*.sqlite >/dev/null 2>&1; then
  echo "== build geography catalog (no artifact found)"
  npm run geography:build
fi
npm run bundle -w packages/server-geo

echo "== terraform init"
# shellcheck disable=SC2046
terraform -chdir="$ROOT" init -input=false -reconfigure $(node scripts/tf-backend-config.mjs "$INSTANCE")

echo "== terraform plan"
terraform -chdir="$ROOT" plan -input=false -out=tfplan

echo "== terraform apply"
terraform -chdir="$ROOT" apply -input=false tfplan
rm -f "$ROOT/tfplan"

echo "== verify the deployed servers"

# One MCP initialize + tools/list against a URL, asserting an expected tool is listed.
verify_server() {
  local url="$1" expect_tool="$2"
  [ -n "$url" ] || { echo "::error:: empty URL for verification"; exit 1; }

  local init_body='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"deploy-verify","version":"0"}}}'
  curl --fail-with-body --retry 5 --retry-delay 10 --retry-all-errors -sS -X POST "$url" \
    -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
    -d "$init_body" >/dev/null

  local tools_body='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  local response
  response="$(curl --fail-with-body --retry 5 --retry-delay 10 --retry-all-errors -sS -X POST "$url" \
    -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
    -d "$tools_body")"

  echo "$response" | grep -q "$expect_tool" || {
    echo "::error:: $expect_tool not found in tools/list from $url"; exit 1; }
}

bls_url="$(terraform -chdir="$ROOT" output -raw bls_custom_domain_url)"
geo_url="$(terraform -chdir="$ROOT" output -raw geo_custom_domain_url)"
verify_server "$bls_url" bls_describe_source
verify_server "$geo_url" geo_describe_source

sha="$(git rev-parse HEAD)"
echo "deployed $sha to $bls_url"
echo "deployed $sha to $geo_url"

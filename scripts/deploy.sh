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
#   - The BLS API key in ./.env as BLS_API_KEY, the Census Data API key as
#     CENSUS_API_KEY, and the HUD User Data API token as HUD_USER_TOKEN
#     (gitignored). They become TF_VAR_bls_api_key / TF_VAR_census_api_key /
#     TF_VAR_hud_user_token and are set on each Lambda as an environment
#     variable (ADR-006 §3); never written to the repo.
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
# The Census Data API requires a key for every data query (ADR-014 §9); same pattern.
[ -n "${CENSUS_API_KEY:-}" ] || { echo "::error:: CENSUS_API_KEY is empty (set it in .env)"; exit 1; }
export TF_VAR_census_api_key="$CENSUS_API_KEY"
# The HUD User Data API requires a token for every data query once an indicator tool lands
# (ADR-018 §7); same pattern.
[ -n "${HUD_USER_TOKEN:-}" ] || { echo "::error:: HUD_USER_TOKEN is empty (set it in .env)"; exit 1; }
export TF_VAR_hud_user_token="$HUD_USER_TOKEN"
# The Socrata App Token for the CDC portal is optional (ADR-016 §3): data.cdc.gov serves untokened
# requests, a token only lifts per-IP throttling. Passed through only when set in .env.
if [ -n "${SOCRATA_APP_TOKEN:-}" ]; then export TF_VAR_socrata_app_token="$SOCRATA_APP_TOKEN"; fi

echo "== identity"
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json

echo "== build + bundle"
npm ci
npm run build

# Both Lambdas bake the geography catalog into their zips (#59, ADR-008 §7). Build the
# catalog artifact once if it is not already present (it is release data, not rebuilt per
# deploy; delete packages/geography-build/dist or set GEO_CATALOG_ARTIFACT to refresh),
# then bundle both servers off it.
if [ -z "${GEO_CATALOG_ARTIFACT:-}" ] && ! ls packages/geography-build/dist/geo-catalog@*.sqlite >/dev/null 2>&1; then
  echo "== build geography catalog (no artifact found)"
  npm run geography:build
fi
npm run bundle -w packages/server-bls
npm run bundle -w packages/server-geo
npm run bundle -w packages/server-census
npm run bundle -w packages/server-hud

# The CDC portal is an OpenContext Lambda built from the commit pinned in opencontext.lock.json
# (ADR-016 §4); the bundle is fetched and built here, never vendored or built in CI.
echo "== bundle OpenContext (portal Lambdas)"
scripts/bundle-opencontext.sh

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

# Actually CALL a catalog-backed tool and assert it returns real data. tools/list only
# proves a tool is registered; it does not open the bundled geography catalog. A catalog
# that cannot open (e.g. a WAL database on Lambda's read-only filesystem, #94) or a
# missing exec role lists its tools fine and errors only on call — so this is what turns
# such a break into a failed deploy instead of a green one. We call `resolve_place`
# (catalog-only) rather than `get_indicator`, so the check exercises the deploy without
# consuming the BLS API quota or coupling to upstream BLS availability.
verify_tool_call() {
  local url="$1" tool="$2" args="$3" expect="$4"
  local body response
  body="$(printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$tool" "$args")"
  response="$(curl --fail-with-body --retry 5 --retry-delay 10 --retry-all-errors -sS -X POST "$url" \
    -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
    -d "$body")"

  # Parse with node (it also unwraps the SSE `data:` framing the server may use). Fails on
  # a JSON-RPC error, an `isError` tool result, the "unable to open database file" catalog
  # symptom, or a missing expected token.
  EXPECT="$expect" TOOL="$tool" URL="$url" node --input-type=module -e '
    let raw = "";
    process.stdin.on("data", (c) => { raw += c; });
    process.stdin.on("end", () => {
      const fail = (m) => { console.error(`::error:: ${process.env.TOOL} on ${process.env.URL}: ${m}`); process.exit(1); };
      const lines = raw.split(/\r?\n/).map((l) => l.replace(/^data:\s*/, "").trim()).filter(Boolean);
      let obj;
      for (const l of lines) { try { obj = JSON.parse(l); } catch { /* skip non-JSON SSE lines */ } }
      if (!obj) fail("no JSON-RPC response parsed");
      if (obj.error) fail(`JSON-RPC error: ${JSON.stringify(obj.error)}`);
      const result = obj.result || {};
      const text = JSON.stringify(result);
      if (result.isError === true || /unable to open database file/i.test(text)) {
        fail(`tool returned an error: ${text.slice(0, 200)}`);
      }
      if (!text.toLowerCase().includes(process.env.EXPECT.toLowerCase())) {
        fail(`expected ${JSON.stringify(process.env.EXPECT)} in the result, got: ${text.slice(0, 200)}`);
      }
    });
  ' <<<"$response"
}

bls_url="$(terraform -chdir="$ROOT" output -raw bls_custom_domain_url)"
geo_url="$(terraform -chdir="$ROOT" output -raw geo_custom_domain_url)"
census_url="$(terraform -chdir="$ROOT" output -raw census_custom_domain_url)"
hud_url="$(terraform -chdir="$ROOT" output -raw hud_custom_domain_url)"
verify_server "$bls_url" bls_describe_source
verify_server "$geo_url" geo_describe_source
verify_server "$census_url" census_describe_source
verify_server "$hud_url" hud_describe_source
cdc_url="$(terraform -chdir="$ROOT" output -raw cdc_custom_domain_url)"
verify_server "$cdc_url" socrata__search_datasets
# Prove the bundled catalog actually opens on each server (not just that tools are listed).
verify_tool_call "$bls_url" bls_resolve_place '{"query":"Denver"}' "Denver"
verify_tool_call "$geo_url" geo_resolve_place '{"query":"Denver"}' "Denver"
verify_tool_call "$census_url" census_resolve_place '{"query":"Denver"}' "Denver"
verify_tool_call "$hud_url" hud_resolve_place '{"query":"Denver"}' "Denver"
# The CDC portal: prove the OpenContext plugin initialised against data.cdc.gov by reading the
# PLACES county dataset's metadata (no token needed; one small upstream call).
verify_tool_call "$cdc_url" socrata__get_dataset '{"dataset_id":"swc5-untb"}' "PLACES"

# ADR-016 §2: every alias hostname must answer like its primary (same API, own certificate).
verify_aliases() {
  local output_name="$1" expect_tool="$2"
  terraform -chdir="$ROOT" output -json "$output_name" | node -e '
    let raw = ""; process.stdin.on("data", (c) => { raw += c; });
    process.stdin.on("end", () => { for (const u of JSON.parse(raw)) console.log(u); });
  ' | while read -r alias_url; do
    verify_server "$alias_url" "$expect_tool"
    echo "alias ok: $alias_url"
  done
}
verify_aliases bls_alias_urls bls_describe_source
verify_aliases geo_alias_urls geo_describe_source
verify_aliases census_alias_urls census_describe_source
verify_aliases hud_alias_urls hud_describe_source
verify_aliases cdc_alias_urls socrata__search_datasets

sha="$(git rev-parse HEAD)"
echo "deployed $sha to $bls_url"
echo "deployed $sha to $geo_url"
echo "deployed $sha to $census_url"
echo "deployed $sha to $hud_url"

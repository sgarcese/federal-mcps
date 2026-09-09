#!/usr/bin/env bash
# The Terraform gates (ADR-005 §2), run visibly and in the same order as CI.
# Local run: `npm run infra:check`. tflint runs only if installed locally; CI always runs it.
set -euo pipefail
cd "$(dirname "$0")/.."

roots=(terraform/modules/github-oidc-deploy-role terraform/modules/bls-server terraform/instances/dev)

echo "== terraform fmt -check -recursive terraform/"
terraform fmt -check -recursive terraform/

for root in "${roots[@]}"; do
  echo "== terraform init -backend=false ($root)"
  terraform -chdir="$root" init -backend=false -input=false >/dev/null
  echo "== terraform validate ($root)"
  terraform -chdir="$root" validate
done

for root in terraform/modules/github-oidc-deploy-role terraform/modules/bls-server terraform/instances/dev; do
  echo "== terraform test ($root)"
  terraform -chdir="$root" test
done

if command -v tflint >/dev/null 2>&1; then
  echo "== tflint"
  tflint --init >/dev/null
  tflint --recursive --chdir=terraform
else
  echo "== tflint not installed locally; CI runs it"
fi

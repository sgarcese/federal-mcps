# The S3 backend's `bucket`, `key` and `region` are supplied at init time, not written here:
#
#   terraform init -backend-config="bucket=rc-tfstate-<account>" \
#                  -backend-config="key=rc/federal-mcps/<instance>/terraform.tfstate" \
#                  -backend-config="region=<region>"
#
# `node scripts/tf-backend-config.mjs dev` prints exactly those flags from
# instances.json; the runbook and deploy.yml use it. This keeps ADR-004 §1's rule
# (the fleet record is the only place an account is named) true for the backend too.

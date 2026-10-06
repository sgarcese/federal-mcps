#!/usr/bin/env bash
# load_dotenv: read ./.env into the environment whenever it exists (#349). Sourced by deploy.sh.
#
# Always read, even when the shell already holds BLS_API_KEY: on 2026-10-06 a shell that had
# sourced an older .env made deploy.sh skip the file, and every Lambda shipped without the
# limiter secrets. Values in .env win over stale shell values. The limiter secrets are optional
# (ADR-020: without them, per-network and pool limits and the operator bypass are off), so a
# missing one is warned about loudly rather than failing the deploy. Values are never printed.
load_dotenv() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
  local name
  for name in FEDERAL_MCPS_CALLER_SECRET FEDERAL_MCPS_OPERATOR_TOKEN; do
    if [ -z "${!name:-}" ]; then
      echo "::warning:: ${name} is not set: per-network and claude.ai-pool limits (caller secret) or the operator bypass and test limit (operator token) will be OFF in this deploy (ADR-020)." >&2
    fi
  done
}

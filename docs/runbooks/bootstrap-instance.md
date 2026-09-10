# Runbook: deploy an instance

This account deploys **locally**, under `AWS_PROFILE=rc-deploy`, matching the Responsive
City pattern (ADR-007): CI validates every change, a person applies. There is no deploy
role to bootstrap and no state bucket to create — the account's `rc-tfstate-<account>`
bucket already exists, and `rc-deploy` can create everything a server needs
(`rc-<service>-<env>` Lambda, role, HTTP API, ACM certificate, Route 53 records).

## Prerequisites

- `AWS_PROFILE=rc-deploy` (or ambient `rc-deploy` credentials) for the instance's account.
  If SSO-backed, `aws sso login --profile <profile>` first.
- `./.env` with `BLS_API_KEY=<your key>` (gitignored). Register free at
  <https://data.bls.gov/registrationEngine/>.
- The account already has the GitHub Actions OIDC provider only if push-to-deploy is
  later adopted (ADR-007 upgrade path); it is **not** needed for local deploys.

## One-time: the execution roles (administrator)

The deploy identity cannot create IAM roles (ADR-007), so an administrator creates each
Lambda's execution role once and lets `rc-deploy` pass it. There is one server per role,
so run the script once per server — the instance hosts both the BLS and geography
servers (ADR-008):

```sh
AWS_PROFILE=<admin> scripts/admin-create-exec-role.sh dev bls
AWS_PROFILE=<admin> scripts/admin-create-exec-role.sh dev geo
```

That creates `rc-bls-mcp-dev-role` and `rc-geo-mcp-dev-role` (each trust Lambda, inline
logs + X-Ray) and grants `rc-deploy` `iam:PassRole` on each. Idempotent; re-running only
updates the policies. The server argument defaults to `bls` if omitted.

## Deploy

```sh
export AWS_PROFILE=rc-deploy
scripts/deploy.sh dev
```

The script confirms the identity, builds and bundles both Lambdas, runs
`terraform init/plan/apply` against `terraform/instances/dev` (backend flags from the
fleet record), then verifies each live endpoint with an MCP `initialize` and
`tools/list` and prints `deployed <sha> to <url>` once per server. Those printed lines
are the per-SHA deploy record (`CLAUDE.md`, amended by ADR-007).

The geography server bakes its catalog into its zip (ADR-008 §7). The script builds the
catalog artifact (`npm run geography:build`, which downloads Census/OMB reference files)
only if none is present under `packages/geography-build/dist/`; delete that directory, or
set `GEO_CATALOG_ARTIFACT` to a specific `.sqlite`, to refresh it. The BLS server needs
the `BLS_API_KEY`; the geography server needs no key — its data is local.

The BLS key is passed as `TF_VAR_bls_api_key` from `.env` and set on the Lambda as the
`BLS_API_KEY` environment variable (ADR-006 §3). It is stored in Terraform state, in the
private `rc-tfstate` bucket, and never written to the repo.

## Verify the deploy actually works (not just responds)

`deploy.sh`'s built-in check does an MCP `initialize` + `tools/list` and calls
`describe_source`. That proves the Lambda booted and lists its tools — but **none of
those open the geography catalog**, so a broken catalog or a missing role still prints
`deployed <sha> to <url>` and looks green. After a deploy — especially the first one that
depends on the catalog — call a **catalog-backed** tool against each live endpoint and
confirm you get data, not an error:

```sh
BLS=https://bls-mcp.responsive.city/mcp
GEO=https://geo-mcp.responsive.city/mcp
H=(-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')

# BLS: resolve a place, then a real number (Denver County unemployment rate).
curl -sS "${H[@]}" -X POST "$BLS" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"bls_resolve_place","arguments":{"query":"Denver"}}}'
curl -sS "${H[@]}" -X POST "$BLS" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"bls_get_indicator","arguments":{"place":"Denver","kind":"county","indicator":"unemployment_rate"}}}'

# Geo: resolve a place off the shared catalog.
curl -sS "${H[@]}" -X POST "$GEO" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"geo_resolve_place","arguments":{"query":"Denver"}}}'
```

The servers are stateless Streamable HTTP, so a bare `tools/call` POST works without a
session. A result with `"isError": true` and text `unable to open database file` means the
catalog didn't open — see Troubleshooting. `describe_source` succeeding tells you nothing
about the catalog.

## Troubleshooting

- **`Error: reading IAM Role (rc-<svc>-<env>-role): couldn't find resource`** (during
  `terraform apply`). That server's execution role was never created. The roles are
  **per server** — run `scripts/admin-create-exec-role.sh <instance> <bls|geo>` for the
  named server under an admin profile, then redeploy. (Easy to miss the second server:
  the BLS role often exists while the geo role was never provisioned.)

- **`admin-create-exec-role.sh` prints nothing and creates no role.** A provisioning
  script that emits *zero* output has died early, not "done nothing" — treat silence as a
  bug. (This was a real defect, #90: a `read` from a newline-less `node` output exited the
  script under `set -euo pipefail` before its first line. Fixed — ensure you're on a
  current checkout.) Confirm the admin identity first with
  `aws sts get-caller-identity --profile <admin>`; it must be able to create IAM roles
  (root or an `AdministratorAccess` identity), which `rc-deploy`/`rc-deployer` cannot.

- **A catalog tool returns `unable to open database file`.** The geography catalog is a
  bundled SQLite file opened read-only on Lambda's **read-only** `/var/task`. A
  `journal_mode=WAL` database cannot open there — even read-only — because it needs to
  create `-wal`/`-shm` sidecar files; the artifact must be a rollback-journal (`DELETE`)
  database (fixed in the build, #94). Because local tests run on a writable filesystem,
  this only shows up once deployed. To recover: confirm
  `sqlite3 packages/geography-build/dist/geo-catalog@*.sqlite 'PRAGMA journal_mode'` is
  `delete`; if it still says `wal`, you have a stale artifact — `deploy.sh` **skips
  rebuilding when any artifact exists**, so delete `packages/geography-build/dist/` (or
  point `GEO_CATALOG_ARTIFACT` at a freshly built `.sqlite`) so the fixed build
  regenerates it, then redeploy.

## First deploy

The first `apply` also creates the ACM certificate and its DNS validation records; the
certificate can take a few minutes to validate, which the script's `curl --retry` in the
verification step is sized for. If the very first verification times out, re-run
`scripts/deploy.sh dev` once DNS has propagated; the apply is idempotent.

## Rotating the key

Update `BLS_API_KEY` in `.env`, then re-run `scripts/deploy.sh dev`. Terraform updates
the Lambda's environment variable in place.

## If a missing OIDC provider ever blocks a future CI upgrade

Local deploys never touch the provider. Push-to-deploy (the ADR-007 upgrade path) would
need an administrator to create the provider (URL
`https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`) and a deploy
role once; that is out of scope for Release 1.

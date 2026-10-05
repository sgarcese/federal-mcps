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
- `./.env` with `CENSUS_API_KEY=<your key>` when a catalog build is needed (see below;
  register free at <https://api.census.gov/data/key_signup.html>).
- `./.env` with `HUD_USER_TOKEN=<your token>`. Register free at <https://www.huduser.gov>
  and generate a token under your account's API access settings.
- `./.env` with `BEA_API_KEY=<your key>`. Register free at <https://apps.bea.gov/API/signup/>
  and activate the key from BEA's email (it can take several minutes to start working).
- Optional: `./.env` with `FEDERAL_MCPS_CALLER_SECRET=<random>` and/or
  `FEDERAL_MCPS_OPERATOR_TOKEN=<random>` (#319, ADR-020 §1, §9); see "Public-use protection"
  below. Neither is required — leaving both unset deploys without a per-identity limiter.
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
AWS_PROFILE=<admin> scripts/admin-create-exec-role.sh dev census
AWS_PROFILE=<admin> scripts/admin-create-exec-role.sh dev cdc
AWS_PROFILE=<admin> scripts/admin-create-exec-role.sh dev hud
AWS_PROFILE=<admin> scripts/admin-create-exec-role.sh dev bea
```

That creates `rc-bls-mcp-dev-role`, `rc-geo-mcp-dev-role`, `rc-census-mcp-dev-role`,
`rc-cdc-mcp-dev-role`, `rc-huduser-mcp-dev-role` and `rc-bea-mcp-dev-role` (each trust Lambda, inline logs + X-Ray) and grants `rc-deploy`
`iam:PassRole` on each. Idempotent; re-running only updates the policies. The server
argument defaults to `bls` if omitted.

## One-time: public-use protection (M17, ADR-020 §10)

Run `scripts/admin-grant-protection.sh <instance>` once per instance, **after** the execution
roles above exist and **before** the M17 deploy (the limiter's Terraform expects the table and
the role grants already in place; `scripts/deploy.sh` itself never creates them, matching
ADR-007):

```sh
AWS_PROFILE=<admin> scripts/admin-grant-protection.sh dev
```

It is idempotent — re-running updates the inline policies in place and skips table creation if
the table already exists. What it does:

- **Creates** the on-demand DynamoDB table `rc-federal-mcps-<env>-limits` (partition key `pk`,
  string; TTL enabled on `expiresAt`), tagged like the project's other resources, unless it
  already exists.
- **Grants** `dynamodb:UpdateItem` and `dynamodb:GetItem`, scoped to that table's ARN only, to
  each non-CDC server's execution role (`rc-bls-mcp-<env>-role`, `rc-census-mcp-<env>-role`,
  `rc-huduser-mcp-<env>-role`, `rc-bea-mcp-<env>-role`, `rc-geo-mcp-<env>-role`). The CDC
  OpenContext portal's role is never touched — ADR-020 §2 notes core's in-app limiter layer does
  not reach OpenContext, so the portal gets only the edge layer (stage throttling and reserved
  concurrency), set by Terraform, not this script.
- **Grants `rc-deploy`** an inline policy with the CloudWatch (alarms, dashboards), SNS and AWS
  Budgets rights the coming monitoring module needs, scoped to `rc-*` resource names wherever
  that AWS service supports resource-level scoping (alarms, dashboards, SNS topics, budgets);
  a few CloudWatch read actions (`DescribeAlarms` and similar) don't support resource scoping at
  all and are granted on `"*"`, same as `admin-create-exec-role.sh`'s existing pattern of adding
  inline policy statements directly to `rc-deploy` rather than managing a separate policy
  document.
- **Activates** the `project` cost-allocation tag (`aws ce update-cost-allocation-tags-status`),
  so per-project cost reporting works ahead of the monitoring module's AWS Budget.
- **Reports** the account's Lambda concurrency (`aws lambda get-account-settings`): the account
  limit, the amount unreserved today, and what would remain unreserved after reserving ADR-020's
  defaults (5 each for bls, census, geo and the CDC portal; 2 each for HUD and BEA — 24 total). It
  warns if fewer than 100 would remain, so reserved concurrency can be set safely before the
  Terraform edge layer applies it.

Pass `--dry-run` to print every AWS call and policy document it would make without calling AWS —
useful for an administrator to review before granting anything for real.

## The CDC portal (OpenContext, ADR-016 §4-5)

The instance also deploys `rc-cdc-mcp-<env>` at `cdc.responsive.city/mcp`: an OpenContext
Socrata Lambda on `data.cdc.gov`, the hosted connector behind the CDC PLACES source guide
(`skills/cdc-places`). Its fleet-record fields are `domain.cdcDomainName` and
`naming.cdcService` — add both to your `instances.json` (see the example). Its execution role is
the fourth `admin-create-exec-role.sh` run above.

- **Source pin.** `opencontext.lock.json` names the OpenContext repository and commit, and the
  portal's runtime packages (`runtimeRequirements`); `opencontext.requirements.lock` holds those
  packages and their dependencies, hash-pinned and stamped with the commit (#277).
  `scripts/bundle-opencontext.sh` (run by `deploy.sh`) fetches that commit into `build/`, refuses a
  lock stamped for another commit, installs only the lock (`--require-hashes`) for the Lambda
  platform and zips. It needs `git` and `uv` (or `pip3`). To take a newer OpenContext: change the
  `commit`, run `scripts/lock-opencontext.sh`, commit both files in one PR — CI audits the lock
  with `pip-audit` and imports the Lambda handler from it — then redeploy.
- **Token (optional).** `SOCRATA_APP_TOKEN` in `.env` becomes `TF_VAR_socrata_app_token` and
  travels inside the Lambda's `OPENCONTEXT_CONFIG`. Without it the portal still works;
  data.cdc.gov may throttle heavy untokened use.
- **Verification.** `deploy.sh` lists the portal's tools and calls `socrata__get_dataset` for the
  PLACES county dataset (`swc5-untb`), failing the deploy unless "PLACES" comes back.

## The HUD User server (M11, ADR-018)

The instance deploys `rc-huduser-mcp-<env>` at `hud-user.responsive.city/mcp` — the HUD User
Data API server (Fair Market Rents, Income Limits and MTSP limits, CHAS, Picture of Subsidized
Households). Its fleet-record fields are `domain.hudDomainName` and `naming.hudService`; its
execution role is the `dev hud` run above.

- **Token.** `HUD_USER_TOKEN` in `.env` becomes `TF_VAR_hud_user_token` and is set on the
  Lambda as the `HUD_USER_TOKEN` environment variable (ADR-006 §3); it is sent as a bearer header
  and never logged. `lambda.ts` warns at cold start if it is missing.
- **Rate limit.** 60 queries a minute per token, enforced by the core client's per-minute
  limiter (`HUD_USER_PER_MINUTE` in `src/index.ts`, #231).
- **Verification.** `deploy.sh` lists `hud_describe_source` and calls `hud_resolve_place` with
  `{"query":"Denver"}`.

## The BEA Regional server (M14, ADR-019)

The instance deploys `rc-bea-mcp-<env>` at `bea.responsive.city/mcp` — BEA Regional economic
accounts by place (personal income, GDP and real GDP by industry, regional price parities). Its
fleet-record fields are `domain.beaDomainName` and `naming.beaService` — **add both to your
`instances.json`** (see the example) before the first deploy that includes it; its execution role
is the `dev bea` run above.

- **Key.** `BEA_API_KEY` in `.env` becomes `TF_VAR_bea_api_key` and is set on the Lambda as the
  `BEA_API_KEY` environment variable (ADR-006 §3). It rides as the `UserID` query parameter at
  fetch time only; BEA echoes it in every response body, and the client's `sanitize` hook strips
  that before anything is cached, recorded or returned (#256). `lambda.ts` warns at cold start if
  it is missing.
- **Limits.** BEA allows 100 requests, 100 MB and 30 errors a minute per key; the core limiter
  holds the server to 90 a minute and never retries a bad-parameter error (ADR-019 §4).
- **Verification.** `deploy.sh` lists `bea_describe_source` and calls `bea_resolve_place` with
  `{"query":"Denver"}`.

## Short hostnames (aliases, ADR-016 §2)

Each server also answers on `<service>.responsive.city/mcp` when the fleet record lists it under
`domain.aliases` (see `instances.example.json`: `bls`, `geo`, `census`; the CDC portal's primary
name is already the short one). Add that block to your
`instances.json` before deploying — a record without it deploys no aliases and the `*-mcp`
primaries alone. Aliases are additive: the primary domain is never recreated, and `deploy.sh`
verifies every alias URL after the apply.

## Public-use protection (#319, ADR-020)

Edge throttling, Lambda reserved concurrency and the in-app `FEDERAL_MCPS_LIMITS` budget are
configured by an optional `limits` block per server in the fleet record (see
`instances.example.json`, which spells out ADR-020's defaults table so you can see the shape).
Every field is also each terraform module's own default, so the block can be omitted entirely;
edit `instances.json` and change a field only to override that server's throttling rate/burst,
reserved concurrency, daily budgets or per-minute quotas. A change takes effect on the next
`scripts/deploy.sh` run (ADR-007's deliberate-act deploy). The optional
`FEDERAL_MCPS_CALLER_SECRET`/`FEDERAL_MCPS_OPERATOR_TOKEN` secrets (ADR-020 §1, §9) come from
`.env`'s `FEDERAL_MCPS_CALLER_SECRET`/`FEDERAL_MCPS_OPERATOR_TOKEN` the same way `BEA_API_KEY`
does; leaving them unset runs every server without a per-identity limiter, as before M17. The
CDC portal gets the edge layer (throttling, reserved concurrency) only — no in-app limits.

## Changing limits (M17.9, ADR-020 §7, §9)

Every limit the family enforces — stage rate/burst, Lambda reserved concurrency, the service's
daily upstream budget, and the per-network and claude.ai-pool daily shares — comes from the
optional `limits` block per server in the fleet record (`instances.json`, ADR-004;
`instances.example.json` spells out the full shape and ADR-020's question-5 defaults). To
change one:

1. Edit the field under `limits.<service>` in your `instances.json` (not the example file,
   which stays a placeholder for self-hosters). For instance, to raise BLS's per-network daily
   upstream share from 100 to 150:

   ```json
   "limits": {
     "bls": {
       "network": { "upstreamDaily": 150, "toolCallsDaily": 500 }
     }
   }
   ```

   Only the fields you set override the module's default (the same ADR-020 defaults shown in
   `instances.example.json`) — you never have to restate the whole block.
2. Redeploy: `AWS_PROFILE=rc-deploy scripts/deploy.sh dev` (ADR-007's deliberate local act).
   Terraform updates the `FEDERAL_MCPS_LIMITS` environment variable, the API Gateway stage
   throttle and the Lambda's reserved concurrency in place; no administrator step is needed for
   a limits-only change (the table and grants from "One-time: public-use protection" above are
   not touched).
3. Verify with `describe_source`: call `<service>_describe_source` on the deployed endpoint and
   check its `limits` block shows the new value (see "Verify the deploy actually works" below
   for the curl pattern).

Two secrets, both optional, both read from `.env` the same way `BLS_API_KEY` is (ADR-006 §3):

- `FEDERAL_MCPS_CALLER_SECRET` — the HMAC secret `identify()` uses to key per-network daily-
  rotating counters (ADR-020 §1). Leaving it unset turns off per-identity limits entirely (the
  service's daily upstream budget, where configured, still applies); setting it for the first
  time starts fresh counters, since no address can be linked to a prior day's key.
- `FEDERAL_MCPS_OPERATOR_TOKEN` — the operator-bypass header value (ADR-020 §9), so the
  project's own pre-release eval run is never refused by the per-network or claude.ai-pool
  shares it would otherwise share with real users. It never exempts the service's daily upstream
  budget. Never commit either value or print it; both become Lambda environment variables the
  same way `BLS_API_KEY` does, never baked into the repo.

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
the `BLS_API_KEY`; the geography server needs no key at serve time — its data is local.

Building the catalog also needs `BEA_API_KEY` (ADR-019 §6, #257): the build reads BEA's
Regional area list for its combination areas (Virginia, Maui + Kalawao). Register free at
<https://apps.bea.gov/API/signup/> and activate the key from BEA's email (it can take several
minutes to work). `npm run` does not read `.env`; load it into the same command:
`set -a && . ./.env && set +a && npm run geography:build`. The weekly `geography-build` workflow
reads both keys from the repository secrets `CENSUS_API_KEY` and `BEA_API_KEY`.

Building the catalog itself now needs `CENSUS_API_KEY` in the environment (ADR-014 §6,
#172): `geography:build` fetches each summary level's ACS 5-year total population from
the Census Data API, which requires a key on every data query, and fails loudly — before
downloading anything — if the variable is unset. Register free at
<https://api.census.gov/data/key_signup.html> and add it to `.env` alongside
`BLS_API_KEY` before running `npm run geography:build` (or before a `deploy.sh` run that
needs to build a fresh catalog). This key is a build-time input only — it is never baked
into the shipped `.sqlite`, never passed as a Lambda environment variable, and is
unrelated to the `CENSUS_API_KEY` the deployed `server-census` Lambda needs at runtime
(ADR-006 §3) for its own ACS calls.

The BLS key is passed as `TF_VAR_bls_api_key` from `.env` and set on the Lambda as the
`BLS_API_KEY` environment variable (ADR-006 §3). It is stored in Terraform state, in the
private `rc-tfstate` bucket, and never written to the repo.

## Verify the deploy actually works (not just responds)

`deploy.sh`'s built-in check does an MCP `initialize` + `tools/list`, and then **calls a
catalog-backed tool** — `bls_resolve_place` and `geo_resolve_place` with `{"query":
"Denver"}` — failing the deploy unless each returns real data (#97). That closes the gap
where a catalog that cannot open (e.g. a WAL database on Lambda's read-only filesystem,
#94) or a missing exec role would list its tools fine and error only on call, so the
deploy printed `deployed <sha> to <url>` and looked green. `resolve_place` is catalog-only,
so the check exercises the deploy without spending BLS API quota. If you still want to
confirm a live number by hand, or check a server independently, call the tools yourself:

```sh
BLS=https://bls.responsive.city/mcp
GEO=https://geo.responsive.city/mcp
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

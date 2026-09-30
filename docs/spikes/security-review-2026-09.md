# Spike: security review after v0.7.0 (September 2026)

Owner request, 2026-09-30: review the dependency alerts (Dependabot, npm) and plan with an emphasis
on security. Everything below was checked on 2026-09-30 against `main` at `7cfa0a7` (v0.7.0, live
eval 77/77) and the deployed configuration in `terraform/`. The review ends in decision questions;
no issue is filed before the owner rules.

## Dependency alerts, as found

**GitHub Dependabot, this repository:** alerts are enabled and **none are open** (0 ever raised).
**Code scanning:** not set up (no CodeQL analysis). **Secret scanning:** 0 open.

**`npm audit` on `main`:** three advisories, all in transitive dependencies, all fixable without a
major version bump (`fixAvailable: true`):

| Package | Severity | Path | Ships in a Lambda? | Exposure |
|---|---|---|---|---|
| `brace-expansion` 5.0.9 | high (CPU denial of service on a crafted `{a},b}` pattern) | `rimraf` → `glob` → `minimatch` (dev tooling) | **No** (0 references in any bundle) | Build machines only, and only with attacker-supplied glob patterns: none |
| `fast-uri` 3.1.7 | moderate (inconsistent host-case normalization via percent-encoded octets) | `@modelcontextprotocol/sdk` → `ajv` | **Yes**, all five agency Lambdas | `ajv` uses it for URI formats and `$ref` resolution in schema validation; no server makes a security decision on a URI host. Low |
| `ip-address` 10.7.0 | moderate (`isInSubnet` across address families) | `@modelcontextprotocol/sdk` → `express-rate-limit` | **No** (the servers use `node:http`, not Express) | None |

**Other repositories under the owner's account** (outside this project; the alerts the owner has
been seeing may be these): `civic-agent-platform` 8 open, `uscis-mcp` 25 open; 13 repositories have
Dependabot alerts **disabled**, among them `data-smart-knight-mcps` and `FEMA_MCP`. The OpenContext
fork this project deploys (`sgarcese/OpenContext-upstream`, pinned in `opencontext.lock.json`) shows
0 open alerts.

## What the review found beyond the alerts

1. **No throttling in front of public, unauthenticated endpoints (the largest risk).** The five
   agency servers and the CDC portal are open by design (ADR-016). Their API Gateway `$default`
   stages set no `default_route_settings` throttling, and no Lambda has reserved concurrency, so the
   only ceiling is the account's regional defaults. Upstream quota is **shared by every caller**: the
   BLS key's 500 queries a day, HUD User's 60 a minute, and BEA's 100 requests / 30 errors a minute —
   and BEA's terms allow it to *block* a key "reasonably believed" to be exceeding limits. One
   script can therefore (a) exhaust the day's BLS quota for everyone, (b) push the BEA key toward a
   block through repeated bad queries, (c) run up Lambda and API cost. The core client's per-minute
   limiter protects upstream *rate*, per Lambda container, not total use across containers.
2. **The OpenContext portal Lambda installs unpinned Python dependencies.** `bundle-opencontext.sh`
   installs the pinned commit's `requirements.txt`, whose entries are open ranges (`httpx>=0.27.0`,
   `aiohttp>=3.13.4`, `requests>=2.33.0`, …) and include tools the Lambda never runs (`pre-commit`,
   `functions-framework`). Each deploy can resolve different versions, and nothing audits them.
3. **GitHub Actions are pinned by tag, not commit** (`actions/checkout@v5`, `setup-node@v5`,
   `setup-terraform@v4`, `setup-tflint@v6`). A moved tag runs new code in CI. Mitigations already in
   place: `permissions: contents: read`, no `pull_request_target`, no deploy credentials in CI
   (ADR-007), and gitleaks is itself verified by checksum.
4. **No automated dependency updates or code scanning.** No `.github/dependabot.yml`; no CodeQL
   workflow; `npm audit` does not run in CI.
5. **Secrets are Lambda environment variables** (ADR-006): BLS, Census, HUD and BEA keys, encrypted
   at rest with the AWS-managed key, readable by anyone with `lambda:GetFunctionConfiguration` in the
   account. Acceptable for public-data keys; Secrets Manager or SSM would narrow who can read them.

**Checked and in order** (no action proposed): the two keys agencies echo or embed never reach disk
(HUD's bearer header, BEA's body echo stripped by `sanitize`, Census and BEA keys as `queryAuth`);
gitleaks scans full history on every PR; raw tools build URLs to fixed agency hosts from
regex-validated input (no request forgery to other hosts); the catalog's full-text search quotes its
input as an FTS5 phrase and binds every value as a parameter; TLS 1.2 on every custom domain;
Lambda roles are administrator-provisioned with logs and X-Ray only; `SECURITY.md` names a private
reporting route; branch rulesets require a passing `ci` check.

## Decisions for the owner

1. **Fix the three npm advisories now.** *Recommended:* one PR, `npm audit fix` (patch/minor bumps
   only), gates, then a redeploy since `fast-uri` ships in every Lambda.
2. **Throttle the public endpoints.** *Recommended:* API Gateway stage throttling per server (a
   steady rate and burst sized well under each agency's quota — e.g. 5 requests/second, burst 10) plus
   Lambda reserved concurrency (e.g. 5 per server) as a hard cost ceiling; both in Terraform, with
   `terraform test` assertions. Alternatives: AWS WAF rate-based rules per IP (finer, costs about
   $5–10 a month per web ACL), or an API key for heavy use (changes the no-auth promise, ADR-016).
3. **Protect the shared daily BLS quota specifically.** *Recommended:* a persistent budget (the core
   `BudgetStore` today is in memory, per container) — e.g. a small DynamoDB counter — so the 500/day
   is enforced across containers and the server answers "quota spent for today" before BLS does.
   Lower-cost alternative: rely on decision 2 and the core cache.
4. **Pin and audit the OpenContext portal's Python dependencies.** *Recommended:* build from a
   locked file (`uv pip compile` of the pinned commit's requirements, runtime packages only),
   committed next to `opencontext.lock.json`, with `pip-audit` in CI against that lock.
5. **Pin GitHub Actions to commit SHAs**, with Dependabot keeping them current. *Recommended:* yes.
6. **Automated updates and scanning.** *Recommended:* `.github/dependabot.yml` for npm (weekly,
   grouped minor/patch), GitHub Actions and Terraform; a CodeQL workflow for JavaScript/TypeScript
   (free for public repositories); `npm audit --omit=dev --audit-level=high` as a `ci` step so a
   production-dependency advisory blocks merges, with the full audit reported but not blocking.
7. **Secrets store.** *Recommended:* defer — public-data keys, already encrypted at rest; revisit if
   the family ever holds a key with private-data scope.
8. **The owner's other repositories** (outside this project): enable Dependabot alerts on the 13
   where they are off, and triage `civic-agent-platform` (8) and `uscis-mcp` (25) in those projects.
   *Recommended:* a question for the owner, not work in this repository.

## Proposed build cut (after the rulings)

A milestone **M15 Security hardening**:
1. npm audit fix + redeploy (decision 1).
2. Terraform: stage throttling and reserved concurrency for every server and the CDC portal, tested
   (decision 2).
3. Persistent BLS budget (decision 3), if ruled in.
4. OpenContext locked, runtime-only dependencies + `pip-audit` (decision 4).
5. CI supply chain: Actions pinned by SHA, `dependabot.yml`, CodeQL, the `npm audit` gate
   (decisions 5–6).

# ADR-020: Public-use protection without authentication

**Status:** accepted (2026-10-05) · **Spike:** [`public-use-protection`](../spikes/public-use-protection.md) ·
**Milestone:** M17 Public-use protection (v1.0) · **Rulings:** recorded on #297 ·
**Affects:** `packages/core` (caller identity, a persistent limiter, the refusal shape, metrics),
every agency server (limits in `describe_source`, the BLS cache and caps), `terraform/` (edge
limits, a limits table, monitoring), `scripts/` (an administrator grant), `docs/` (privacy, connect,
runbook)

## Context

The six public endpoints (five agency servers and the CDC OpenContext portal, ADR-016) are
unauthenticated by design and, as of v0.8.0, unthrottled: no stage throttling, no reserved
concurrency, no WAF. The upstream quotas they spend are shared by every caller. BLS allows 500
queries a day, and one `bls_get_raw` call can spend all of them. HUD User allows 60 a minute. BEA
allows 100 a minute and 30 errors a minute, and may block the key. The core budget and per-minute
limiters are in memory per Lambda container, so they do not hold across containers. BLS timeseries
responses are never served fresh from cache.

The owner wants the endpoints shared widely without building authentication first, with limits on
total use per session or client and with monitoring. That milestone gates v1.0.0.

The spike found four constraints that shape every choice:
- **Sessions can't identify a client.** The servers are stateless and issue no `Mcp-Session-Id`, and
  MCP 2026-07-28 removes the header.
- **The source IP is the only usable key, and the server can't see it yet.** The Lambda adapter
  drops `requestContext.http.sourceIp`.
- **All claude.ai users share one published range,** `160.79.104.0/21`.
- **WAF cannot attach to an HTTP API.**

## Decision (owner rulings, 2026-10-05)

1. **Identity.** Limits are keyed on the source IP from `requestContext`:
   - The adapter forwards it as an internal header and strips any client-sent copy.
   - It is stored only as a daily-rotating HMAC, kept at most two days.
   - The Anthropic range `160.79.104.0/21` is one capped **claude.ai pool**.
   - `User-Agent` and MCP `clientInfo` are metric labels, never enforcement keys.

   The adapter exposes one `identify()` seam, which an authentication layer replaces later
   (keys per client instead of inferred identity).
2. **Four layers.**
   - **Edge:** API Gateway stage throttling and Lambda reserved concurrency on all six functions,
     in Terraform. This is a cost and noisy-neighbour ceiling that an honest user never meets.
   - **Fair share:** core counters in DynamoDB for the family-wide BLS service budget and for
     per-identity daily shares of upstream queries and tool calls (per network and for the pool).
   - **Per-minute upstream limits by split:** HUD and BEA `perMinute` set to the quota divided by
     reserved concurrency, plus a BEA error limiter split the same way. This needs no store.
   - **Input caps:** `bls_get_raw` takes at most 200 ids, and QCEW CSV slices use their own budget
     key, not the BLS API's 500.

   No WAF in M17. The CDC portal gets the edge layer only, because core's in-app layer does not
   reach OpenContext.
3. **Degraded store.** If DynamoDB fails, per-identity shares fail open, the service budget falls
   back to the in-memory counter, and a `limiter_degraded` metric raises an alarm.
4. **What a limited caller sees.** Stale cache first, flagged with the reason. Otherwise an
   `isError` result with a plain sentence that names:
   - what was limited;
   - whose share it was (this network, all claude.ai users, or the whole service);
   - the number and the reset time;
   - which of the server's tools still work.

   The error also carries an envelope-shaped `structuredContent` with `data: null` and a **`limit`
   block** (`scope`, `limit`, `used`, `resetsAt`). The contract suite enforces it. Past 80% of a
   service budget, answers carry a warning limitation. `describe_source` gains a `limits` block
   with the configured limits and today's remaining service budget.
5. **Monitoring.**
   - One structured EMF log line per tool call, with no arguments: server, tool, outcome, latency,
     upstream calls, cache hit, limit scope.
   - The lean set of custom metrics, **plus per-tool metric dimensions**.
   - One dashboard and about ten alarms (upstream budget near its end, refusals, errors, a degraded
     limiter, spend).
   - An AWS Budgets cost alert, and an SNS topic that emails the owner.
6. **Defaults** are the spike's table (question 5). For BLS:
   - a 490-query service budget (10 held back for BLS's clock);
   - 100 BLS queries a day per network;
   - 250 a day for the claude.ai pool;
   - tool-call ceilings about ten times a heavy session.

   Stage throttling is 10 requests a second with a burst of 20. Reserved concurrency is 5, or 2
   for HUD and BEA.
7. **Configuration.** A `limits` block per server in the fleet record (ADR-004) flows through
   Terraform into one `FEDERAL_MCPS_LIMITS` environment variable and into the stage and function
   settings. A change is an edit and a `scripts/deploy.sh` run (ADR-007). Module defaults carry
   the table, so self-hosters get it without configuration. Stdio and local runs have no limiter.
8. **The BLS cache and #51's stage 0.**
   - BLS timeseries responses get a **24-hour** fresh TTL, with stale served on failure.
   - A BLS threshold refusal is raised as `QuotaExceededError`.
   - Upstream calls are counted in the metrics.

   This is the main lever for serving more people from the same quota.
9. **Operator bypass.** A secret header (a sensitive variable, not documented publicly) exempts a
   request from per-network and pool shares, but not from the service budget, so the release
   eval is never refused by its own shares. *Amended 2026-10-06 (#347, owner ruling):* the same
   token, with `x-federal-mcps-test-limit: <1–10>:<runId>`, counts a request against an isolated
   test counter with that limit, which is a real limit rather than a bypass. It lets the live smoke test
   provoke a refusal in four calls without spending anyone's share. Without the token, the
   header is ignored.
10. **Administrator step.** `scripts/admin-grant-protection.sh <instance>`, idempotent and run once
    by an administrator. It:
    - creates the `rc-federal-mcps-<env>-limits` table (on demand, TTL on `expiresAt`);
    - grants each execution role `dynamodb:UpdateItem` and `GetItem` on that table;
    - grants `rc-deploy` the CloudWatch, SNS and Budgets rights on `rc-*` names;
    - activates the `project` cost-allocation tag;
    - reports the account's Lambda concurrency, so reserved concurrency can be set safely.
11. **Privacy.** `privacy.md` states the hashed, daily-rotated network counters (kept at most two
    days), the per-call log line's fields, and that no arguments are logged.
12. **v1.0.0** is tagged when all of the following hold:
    - M17 is deployed and verified per SHA;
    - the live eval passes with the limiter on (through the bypass);
    - a live test shows a refusal with its message and reset time;
    - the owner commits the family verbs and the envelope, including `limit`, as stable (ADR-012).

## Consequences

- **The envelope gains `limit` before 1.0.** It is part of what v1.0.0 commits to.
- **A script inside the Anthropic range can spend the claude.ai pool for every claude.ai user.**
  This is the design's known weak point, and `connect.md` names it. The remedy is lowering the
  pool's limits or, later, authentication.
- **Rotating addresses defeats per-network shares but not the service budget,** and the alarms
  tell the owner when that is being spent.
- **Answers can be a day old.** The 24-hour cache means a release-morning answer may lag BLS by up
  to a day. The answer's `cache` info and vintage say which period it is.
- **The deploy needs an administrator once more,** to create the table and grants. Nothing else
  changes in ADR-007's deploy path.
- **Monitoring is the main running cost,** about $13–17 a month with per-tool metrics. The limiter
  costs cents.

## Alternatives rejected

- **Session ids as identity:** the server issues none, a client can mint one freely, and the
  protocol is removing them.
- **WAF now:** it cannot see HTTP APIs without a REST migration or a CloudFront layer, and its
  per-IP key has the same claude.ai-range problem, with a worse message (an HTTP 429, not an MCP
  answer).
- **Edge limits only:** they bound cost but give no totals, no fair share, and an error hosts show
  without a reason.
- **Fail closed when the store fails:** a DynamoDB outage would take the servers down.
- **A live limits config in DynamoDB:** it would move configuration out of the reviewed fleet record.

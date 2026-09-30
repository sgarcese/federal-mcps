# Spike: public-use protection without authentication (M17, v1.0)

Issue #297, milestone M17 "Public-use protection (v1.0)". This spike takes up decisions 2 and 3 of
the [security review](security-review-2026-09.md) (stage throttling and reserved concurrency; a
persistent BLS budget), which the owner deferred on 2026-09-30. The owner's request, the same day:
add monitoring to the hosted servers and a way to cap calls per session or per client, so the
endpoints can be shared more widely without building an authentication layer yet, and make this
the milestone that enables v1.0.

Everything marked *verified* was read from `main` at `761dc97` (v0.8.0) or checked read-only
against the deployed `dev` instance under `rc-deploy` on 2026-09-30. Prices were read from AWS's
pricing pages on 2026-09-30 (US East, N. Virginia). No resource was changed and no issue was filed.
The spike ends in decision questions and a proposed build cut.

## What is deployed, verified

**Six public endpoints, all API Gateway HTTP APIs (v2).** `terraform/modules/{bls,census,geo,hud,bea}-server`
and `opencontext-portal` (the CDC portal) are the same shape: one Lambda, one
`aws_apigatewayv2_api` with `protocol_type = "HTTP"`, a `$default` stage with `auto_deploy`,
`POST /mcp` and `GET /mcp` routes on an `AWS_PROXY` integration (payload format 2.0), a regional
custom domain (TLS 1.2) plus the ADR-016 alias domains, and Route 53 alias records. `get-apis`
lists `rc-{bls,census,geo,huduser,bea,cdc}-mcp-dev-api`, all `HTTP`. **No CloudFront** is in front
of any of them, and no WAF web ACL is attached (WAF cannot attach to an HTTP API; see below).

**No throttling anywhere.** The BLS stage's `DefaultRouteSettings` is `{"DetailedMetricsEnabled": false}`
(no rate or burst), and `get-function-concurrency` for `rc-bls-mcp-dev` returns nothing: no reserved
concurrency. The Terraform sets neither for any module. The only ceilings are the account's:
API Gateway's 10,000 requests a second with a 5,000 burst, **per account and Region, shared by every
API in it** ([quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html)),
and Lambda's account concurrency, which `rc-deploy` cannot read (`lambda:GetAccountSettings`
denied). The account also runs about twenty `rc-*-mcp-prod` OpenContext portals for other
projects (their API log groups are visible), so a flood on one federal endpoint draws on the same
account-wide pools as the owner's city portals.

**Lambdas:** Node 22 on arm64, 512 MB, 29 s timeout (the HTTP API's integration timeout is 30 s), X-Ray
active; the CDC portal is Python 3.11 on x86_64. Log groups `/aws/lambda/<fn>` and
`/aws/apigateway/<fn>` keep **30 days**.

**Access logs** carry `requestId`, `status`, `ip` (`$context.identity.sourceIp`), `routeKey` and the
integration error. No tool name, no arguments.

## The transport: what the server can see

**Stateless, one fresh transport per request** (`packages/core/src/server/http.ts`): the SDK's
`StreamableHTTPServerTransport` with no `sessionIdGenerator` and `enableJsonResponse: true`. The
server never issues an `Mcp-Session-Id`, so a conforming client never sends one back. The eval
runner (`docs/evals/run.mjs`) goes further: it posts a bare `tools/call` with no `initialize` at all,
and the server answers it.

**The Lambda adapter** (`packages/server-*/src/lambda.ts`) replays each API Gateway event as a
real HTTP request against a loopback `node:http` server started once per container, passing
`event.headers` through. So a tool handler's SDK `extra.requestInfo.headers` holds every client
header: `user-agent`, any `mcp-session-id`, and API Gateway's `x-forwarded-for`. It does **not**
hold `event.requestContext.http.sourceIp`: the adapter drops the request context, and the loopback
socket's address is `127.0.0.1`. The `x-forwarded-for` header is not a safe substitute, because a
client can send its own value, which API Gateway prepends to rather than replaces.

**The shell passes nothing about the caller to a tool.** `createServer` hands a handler
`{ now, signal }` only (`create-server.ts`); `extra.requestInfo` stops at the shell.

**`clientInfo` arrives only on `initialize`,** and the SDK stores it on the `Server` object
(`_oninitialize` sets `_clientVersion`). One `McpServer` serves every request a container handles,
so `getClientVersion()` returns whichever client last initialized on that container. It is not a
per-request fact and must never be used as one.

**The protocol is dropping sessions.** The MCP specification revision
[2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog) removes
protocol-level sessions and the `Mcp-Session-Id` header (SEP-2567) and the `initialize` handshake
(SEP-2575). Every request carries its protocol version and client capabilities in `_meta`, clients
SHOULD send `io.modelcontextprotocol/clientInfo` on each request, and Streamable HTTP POSTs must
carry `Mcp-Method` and `Mcp-Name` headers (SEP-2243). The installed SDK, 1.30.1, still speaks
`2025-11-25` at most. Any design keyed on a session id would be built on a header that is leaving
the protocol.

**Where claude.ai traffic comes from.** Anthropic publishes one outbound range for MCP tool calls to
external servers: `160.79.104.0/21`, 2,048 addresses
([IP addresses](https://platform.claude.com/docs/en/api/ip-addresses)). Every claude.ai connector user
therefore arrives from that range, whoever they are. Claude Code, and any host run on a person's
own machine, connects from that person's own address.

## What the core client does today, verified

`packages/core/src/http/client.ts`, per `createHttpClient` instance, which is one per Lambda
container:

- **Budget counter.** `MemoryBudgetStore(limitPerDay)` is a `Map` keyed `source:YYYY-MM-DD` (UTC),
  consumed once per upstream fetch before the request (retries after a 5xx or 429 are not counted),
  and it throws `QuotaExceededError` with the next UTC midnight. The limits are BLS 500, Census 5,000,
  HUD 50,000 and BEA 50,000 (the last three are placeholders: those agencies publish no daily cap).
  **Each container has its own count, and a new container starts at zero.** With *n* warm
  containers BLS can be asked 500 × *n* times before any container stops; BLS's own refusal is the
  real ceiling. The architecture doc's "DynamoDB in Lambda" budget was never built (drift, noted
  for the build).
- **The budget over-counts BLS.** QCEW CSV slices from `data.bls.gov` go through the same `"bls"`
  client as the timeseries API, so they draw on the 500 although they are not API queries.
- **Per-minute limiter** (`perMinute`, ADR-018 §5): a token bucket, per container. HUD is set to
  60 and BEA to 90. With *n* containers the account can send 60 × *n* HUD queries a minute: the
  limiter guarantees HUD's limit only while one container runs.
- **Nothing counts BEA errors.** Non-retryable BEA codes are not retried, but no guard stops a
  caller sending many bad `bea_get_raw` queries; BEA allows 30 errors a minute and may block the key.
- **Cache.** `MemoryCacheStore`, per container, keyed by request (never by caller); a stale entry is
  served when a refetch fails, including on `QuotaExceededError`. TTLs: QCEW, ACS, decennial,
  Census raw and HUD 30 days; BEA 7 days. **The BLS timeseries API is not cached at all:** no caller
  of `fetchSeriesRaw`/`fetchSeriesObservations` passes `freshTtlSeconds`, so every LAUS, CES, OEWS,
  CPI, JOLTS, PPI and CPS answer is a fresh BLS query.

**Fan-out per tool call** (from the input schemas): `*_compare_places` takes 2–20 places; a BLS
compare packs up to 50 series in one query. QCEW history reads one CSV per area and period, up to
20 periods. **`bls_get_raw` accepts any number of series ids** (`z.array(z.string()).min(1)`, no
maximum) and batches them 50 to a query, so one call with 25,000 ids would spend the whole day's
500 queries. Census raw is capped at 50 variables, HUD raw at 10.

**Logging and metrics:** none in the application beyond cold-start `console.warn`s for a missing
key. No EMF, no custom metrics, no dashboard, no alarm. `docs/privacy.md` promises that tool
arguments and responses are not logged and that "there is no database of users or queries".

## What `rc-deploy` can and cannot do, verified 2026-09-30

Read-only probes under `AWS_PROFILE=rc-deploy`:

| Probe | Result |
|---|---|
| `apigatewayv2 get-apis`, `get-stages` | allowed |
| `lambda get-function-concurrency`, `get-function-configuration` on `rc-bls-mcp-dev` | allowed |
| `lambda get-account-settings` | denied |
| `logs describe-log-groups` | allowed |
| `logs start-query`, `filter-log-events`, `describe-metric-filters` | denied |
| `cloudwatch get-metric-statistics`, `list-dashboards`, `describe-alarms` | denied |
| `dynamodb list-tables` | denied |
| `wafv2 list-web-acls` | denied |
| `sns list-topics` | denied |
| `iam simulate-principal-policy`, `list-role-policies` on itself | explicitly denied |

Two consequences. First, **this spike could not measure live traffic**: the deploy identity can
neither query the access logs nor read a metric. The sizing below comes from the code and the
eval sets, not from observed use. Second, a list denial proves nothing about create rights (list
calls need `Resource: "*"`, which an `rc-*`-scoped policy never grants), but nothing shows that
`rc-deploy` can create a DynamoDB table, a dashboard, an alarm, an SNS topic or a web ACL. **Assume
every one of them needs an administrator**, like the execution roles (ADR-007 §4). Stage throttling
and reserved concurrency are settings on resources `rc-deploy` already manages; they very likely
need nothing new (`lambda:PutFunctionConcurrency` is not proven). Reading the dashboard itself needs
a console identity with CloudWatch read, which `rc-deploy` is not.

## Question 1: identity without authentication

| Key | What it stops | Whom it wrongly blocks or lets through | Verdict |
|---|---|---|---|
| **`Mcp-Session-Id`** | Nothing today: the server issues none, so no client sends one. If the server minted one, a script would simply omit it or start a new session per call. | It is being removed from the protocol (2026-07-28). | Not viable. |
| **Source IP** (`requestContext.http.sourceIp`) | A script on one machine; one Claude Code user's runaway loop. It costs an attacker real effort to rotate addresses (a cloud fleet, proxies), not zero. | **Every claude.ai user shares `160.79.104.0/21`**, so a per-address limit is a lottery over how Anthropic spreads calls across 2,048 addresses. A city hall behind one NAT, which is exactly the target user, is one address for all its analysts. | The only key worth enforcing on, with the Anthropic range treated as its own pool and limits sized for an office, not a person. |
| **`User-Agent`, `clientInfo`** | Nothing: both are self-asserted and free to change. | Nothing. | Good for classification and metrics (which hosts use the servers), never for enforcement. |
| **A combination** | Source IP for enforcement; the Anthropic range as one "hosted client" pool with a larger allowance; user agent and `clientInfo` as metric labels only. | An abusive claude.ai user can spend the pool's allowance for all claude.ai users that day. Nothing short of per-user authentication fixes that. | **Recommended.** |

**The scarce thing is the upstream quota, not the endpoint.** Whatever the identity key, the limit
that protects every user is a **family-wide upstream budget** kept in a persistent store (BLS's 500
a day, counted across containers), with each identity allowed only a share of it. A caller who
evades per-identity limits by rotating addresses still stops at the shared budget, and the budget
answer ("BLS's daily quota is spent; resets at …") is honest to everyone.

**Privacy.** Identity keys are stored as `HMAC-SHA256(secret, date ‖ ip)`: not reversible, not
linkable across days, and expired by DynamoDB TTL after two days. The secret is a sensitive
Terraform variable (ADR-006 §3). `docs/privacy.md` must change in the same PR as the code, because
"there is no database of users or queries" stops being true in the literal sense.

## Question 2: where limits live

| Layer | What it limits | Keyed by | Needs | Cost (US East, 2026-09-30) |
|---|---|---|---|---|
| **API Gateway stage throttling** (HTTP API `default_route_settings`) | Rate and burst for all callers together, per stage; answers `429` before the Lambda runs. Not totals. | Nothing: all callers share it. | Terraform only. | Free. |
| **Lambda reserved concurrency** | Concurrent executions per function: the **cost ceiling**, and it keeps a flood off the account's shared pool. Needs 100 unreserved in the account. | Nothing. | Terraform; `lambda:PutFunctionConcurrency` (probably held); an admin check of the account limit. | Free. |
| **AWS WAF rate-based rule** | Requests per IP over a 1, 2, 5 or 10-minute window, minimum 10. Can aggregate on a header or forwarded IP. | IP (or a header). | **Cannot attach to an HTTP API.** Needs a REST API migration (all six modules and the adapters' payload format) or CloudFront in front. Admin grants. | Web ACL $5/month + $1 per rule + $0.60 per million requests ([WAF pricing](https://aws.amazon.com/waf/pricing/)); REST APIs cost $3.50 per million against HTTP's $1.00 ([API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/)). |
| **CloudFront flat-rate plan** (WAF included) | IP rate limiting over 5 minutes, DDoS protection. | IP. | A distribution per plan; **3 free plans per account**; admin grants; six hostnames to front. | Free plan $0 (1M requests, 100 GB), Pro $15/month (10M requests), no overage charges ([CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/), [plan docs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)). |
| **In-app counters in core, DynamoDB** | Per-identity daily totals (tool calls, upstream queries) and the family-wide daily upstream budget, with a message the host shows the model. | The identity of question 1, per server. | Code in core; a table; `dynamodb:UpdateItem`/`GetItem` on the execution roles (admin). | Under $0.20/month at 100k tool calls (table below). |

**The per-minute limits need no store.** HUD's 60 a minute and BEA's 100 a minute can be guaranteed
across containers by splitting the quota by reserved concurrency: with reserved concurrency *r*, each
container's `perMinute` is ⌊quota ÷ *r*⌋. HUD at *r* = 2 gives 30 a minute each; BEA at *r* = 2 gives
45. The same split applies to a new **BEA error limiter** (30 errors a minute ÷ *r*). The cost is
that a single container runs at half the upstream rate, which matters only for a 20-place HUD
compare; at 30 a minute it fits inside the 29-second timeout. Daily totals cannot be split this way,
because containers recycle and a new one starts at zero.

**Recommended layered minimum:**
1. **Edge ceiling, Terraform only:** stage throttling and reserved concurrency on all six functions,
   set well above one honest session. Its job is cost and noisy-neighbour protection, and an honest
   user should never meet it, because the `429` it returns is an HTTP error and not an MCP answer:
   hosts show it as a failed connector call with no reason.
2. **In-app fair share, core + DynamoDB:** the persistent family budget for BLS's 500 a day, with
   per-identity daily shares of upstream queries and of tool calls, answered as a plain tool error
   with the reset time.
3. **Per-minute upstream limits by split** (HUD, BEA), plus the BEA error limiter, with no store.
4. **Input caps** where one call can spend a day: a maximum on `bls_get_raw` ids (e.g. 200, which
   is 4 queries), and QCEW moved to its own budget key so CSVs stop drawing on the API's 500.
5. **No WAF in M17.** It cannot see the HTTP APIs without a migration or a CloudFront layer, and its
   per-IP key has the same Anthropic-range problem as the in-app one while giving a worse message.
   Revisit it if an attack gets past layer 1, with the CloudFront flat-rate Free plan as the first
   option (verify first that one distribution can front six hostnames, or that three free plans are
   available in an account shared with other projects).

The CDC portal is OpenContext (Python): core's in-app layer does not reach it. It gets layer 1
only. Socrata's per-IP throttling is lifted by the app token (ADR-016 §3), and any finer limit
belongs in the OpenContext fork.

### Cost ceilings the edge layer buys

With no reserved concurrency, a sustained flood is bounded only by the account's Lambda
concurrency (unreadable here; AWS's default is 1,000) and 10,000 requests a second. With reserved
concurrency *r*, a function can bill at most *r* × 0.5 GB × 2,592,000 s a month. At *r* = 5 that is
6.48M GB-seconds, about **$86** a month per server at Arm's first-tier $0.0000133334 per GB-second
([Lambda pricing](https://aws.amazon.com/lambda/pricing/); the per-GB-second figure is read from
the page's price table), plus requests. That is the worst case under a sustained attack, not a
forecast, and alarms (question 4) should catch it within an hour. At *r* = 2 it is about $35.

### Cost at plausible volumes

Assumptions: about 1.5 HTTP requests per tool call (hosts also send `initialize`,
`notifications/initialized` and `tools/list`); 1 s average duration at 512 MB; 2.2 DynamoDB writes per
tool call (one identity counter, and about 0.6 upstream fetches × 2 counters); one ~400-byte
structured log line per call.

| Item | 10k tool calls/month | 100k tool calls/month | Source |
|---|---|---|---|
| API Gateway HTTP ($1.00/M) | $0.02 | $0.15 | API Gateway pricing |
| Lambda requests ($0.20/M) + duration (5k / 50k GB-s) | $0.07 | $0.69 (both inside the 1M-request, 400k GB-s free tier if the account's other Lambdas leave it unused) | Lambda pricing |
| DynamoDB on demand (22k / 220k writes at $0.625/M; reads $0.125/M; storage within 25 GB free; TTL deletes free) | $0.01 | $0.14 | [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/), [TTL docs](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) |
| Log ingestion for the per-call line ($0.50/GB) | < $0.01 | $0.02 | [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) |
| Custom metrics via EMF, lean set of 25 (10 free, then $0.30 each) | up to $4.50 | up to $4.50 | CloudWatch pricing |
| Per-tool metric dimensions (about 28 more) | + up to $8.40 | + up to $8.40 | CloudWatch pricing |
| One dashboard (3 free per account, then $3) | $0–3 | $0–3 | CloudWatch pricing |
| About 10 alarms (10 free per account, then $0.10 each) | $0–1 | $0–1 | CloudWatch pricing |
| AWS Budgets cost alert | $0 | $0 | [Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/) |
| SNS email alerts | ~$0 | ~$0 | SNS pricing (free-tier figure not confirmed on 2026-09-30; see *Not verified*) |
| **Recommended set, total** | **about $5–9** | **about $6–10** | |
| WAF on a REST API or CloudFront (not recommended now) | + about $6–7 | + about $6–7 | WAF pricing |

Custom-metric charges are prorated by the hour a metric is published, so quiet months cost less
than the ceiling shown. The free tiers are per account, and this account runs other projects, so
the ranges show both ends. **Monitoring, not limiting, is the main cost; the limiter itself is
cents.**

## Question 3: what a limited caller sees

Today a `QuotaExceededError` renders as `bls: daily quota exceeded, resets at <iso> (<tool>)`, an
`isError` result with text only and no envelope. The recommended shape for every limit:

1. **Stale before refusal.** The client already serves a cached value when a refetch fails; a limit
   refusal takes the same path, with `cache.stale: true` and a limitation naming the reason ("served
   from cache: today's BLS quota for this network is spent; resets 2026-10-01T00:00:00Z").
2. **Otherwise an `isError` tool result, never an empty answer.** The text names what was limited,
   whose share (this network, all claude.ai users, the whole service), the number, and the reset:
   `bls: this network has used its 100 BLS queries for today; resets at 2026-10-01T00:00:00Z. Other
   BLS tools that need no new query (resolve_place, list_indicators, describe_source) still work.`
   The last sentence stops a model from giving up on the whole server.
3. **An envelope-shaped `structuredContent`** on the error, with `data: null`, the limitation, and a
   `limit` block (`scope`, `limit`, `used`, `resetsAt`), so a host that reads structure gets the same
   facts. This is a contract change and needs a contract-suite rule; it is decision 4 below.
4. **A warning before the wall.** When the family budget passes 80%, every answer that spent a
   query carries the limitation "BLS daily quota 85% used; later answers may come from cache or be
   refused until <reset>."
5. **Discoverable limits.** `describe_source` gains a `limits` block: the configured per-network,
   hosted-pool and service limits for this server, and today's remaining service budget (one
   DynamoDB read). A model can then read the limits before a long session.

**How it looks to each kind of user:**

- *An honest analyst in claude.ai* never meets the edge. On a heavy day the claude.ai pool may run
  low; they first get cached answers flagged as such, then a sentence with the reset time that
  Claude can relay. They cannot raise their own limit, which is the price of no authentication.
- *An honest heavy user in Claude Code* gets a per-network share of their own, unaffected by
  claude.ai traffic. An office sharing one address shares that share, so it must be sized for a
  team (question 5).
- *An abusive script* at one address stops at its daily share within the first day, and at the
  edge's rate ceiling within seconds. Rotating addresses gets past the share but not the service
  budget, which it can spend for everyone; the alarm then tells the owner, whose remedy today is
  lowering limits or, later, authentication.
- *A script inside the Anthropic range* (someone driving claude.ai hard) spends the pool for all
  claude.ai users. That is this design's known weak point, and it is named in `connect.md`.

**How the owner sees and configures it:** limits live in the fleet record and Terraform (question 5);
the dashboard shows calls, refusals by scope, upstream use against each quota and cost; alarms
email the owner. `describe_source` shows the live limits to anyone.

## Question 4: monitoring

**Recommended:**

- **One structured log line per tool call**, written by the shell as CloudWatch Embedded Metric
  Format: server, tool, outcome (`ok`, `tool_error`, `limited:<scope>`, `upstream_error`),
  duration, upstream fetches and cache hits by source, identity *class* (`network`, `hosted_pool`),
  host name from `User-Agent`/`clientInfo` truncated to a known list or `other`. **Never
  arguments, never results, never the hashed identity.** Place names and series ids are not
  personal data, but a free-text argument can hold anything, and `privacy.md` promises arguments are
  not logged. EMF needs no new IAM: the execution roles already hold `logs:PutLogEvents`, and
  CloudWatch extracts the metrics from the log.
- **Metrics (lean set, 25):** per server `ToolCalls`, `ToolErrors`, `LimitRefusals`; per upstream source
  (`bls-api`, `bls-qcew`, `census`, `hud`, `bea`) `UpstreamRequests` and `BudgetUsed`. Tool and host stay
  as log fields, queried with Logs Insights when needed ($0.005 per GB scanned). Per-tool metric
  dimensions are an option at about $8 a month more.
- **Free AWS metrics** do the rest: `AWS/ApiGateway` `Count`, `4xx`, `5xx`, `Latency` per API, and
  `AWS/Lambda` `Invocations`, `Errors`, `Throttles`, `ConcurrentExecutions` per function. These also
  cover the CDC portal, which the EMF line does not reach.
- **One dashboard**, `rc-federal-mcps-<env>`: calls per server, refusals by scope, each upstream
  budget against its quota (BLS used vs 500), 5xx and throttles, and estimated charges.
- **Alarms** (about 10): BLS budget ≥ 80% of the day; any server's 5xx rate over 5% for 15 minutes;
  Lambda `Throttles` > 0 for 15 minutes (the edge is being hit, so someone is hammering or the
  ceiling is too low); `LimitRefusals` spike (over 50 in an hour); BEA upstream errors near 30 a
  minute; and an **AWS Budgets** monthly cost alert on the `project = federal-mcps` tag (requires the
  tag activated as a cost-allocation tag in Billing, an administrator step).
- **Where alerts go:** an SNS topic `rc-federal-mcps-<env>-alerts` with the owner's email as a
  subscription, the address a sensitive variable in `.env` like the keys. Nothing else is needed
  for one owner.

All of it is Terraform in a new `monitoring` module under the instance root, applied by
`scripts/deploy.sh`, once an administrator has granted `rc-deploy` `cloudwatch:PutDashboard`,
`cloudwatch:PutMetricAlarm`, `sns:CreateTopic`/`Subscribe` on `rc-*` names and `budgets:*` for
one budget, or has created them once by script as with the roles.

## Question 5: sizing and configuration

**What a session does**, from the eval sets (`docs/evals/*.jsonl`, 2026-09-30): 88 runnable cases,
each **one** tool call, with no `initialize`: BLS 42 (33 `get_indicator`, 4 compare, 2 raw, 2 list, 1
describe), HUD 22, BEA 14, Census 10, plus 18 guided cases run by hand. A full eval run from the
owner's address is therefore about 42 BLS tool calls and at most about 40 BLS queries, **8% of the
day's 500**, since every BLS indicator call is a fresh query (no timeseries cache). A person's
session in a host adds `resolve_place` (catalog only, no upstream) and usually one to three
indicator or compare calls per question: roughly 20–40 tool calls and 15–30 upstream queries for a
ten-question session. These are estimates from the tool design and the eval shapes; real traffic
could not be read (see the `rc-deploy` table).

**Proposed defaults** (per server unless noted; UTC days):

| Limit | BLS | Census | HUD | BEA | geo | CDC |
|---|---|---|---|---|---|---|
| Stage rate / burst (req/s) | 10 / 20 | 10 / 20 | 10 / 20 | 10 / 20 | 10 / 20 | 10 / 20 |
| Reserved concurrency | 5 | 5 | 2 | 2 | 5 | 5 |
| Upstream per minute per container | — | — | 30 | 45 (errors 15) | — | — |
| Service daily upstream budget | **490** BLS API queries (10 held back for BLS's clock) | 5,000 | — | — | — | — |
| Per network, upstream queries a day | 100 | 1,000 | 1,000 | 1,000 | — | — |
| claude.ai pool, upstream queries a day | 250 | 3,000 | 3,000 | 3,000 | — | — |
| Per network, tool calls a day | 500 | 500 | 500 | 500 | 1,000 | edge only |
| claude.ai pool, tool calls a day | 5,000 | 5,000 | 5,000 | 5,000 | 10,000 | edge only |
| `bls_get_raw` ids per call | 200 | | | | | |

Rationale: 100 BLS queries a network covers two eval runs or three heavy sessions; the pool's 250
lets about ten claude.ai sessions a day draw on BLS before cached answers take over, while leaving
the rest of the 490 for everyone else. The tool-call ceilings sit about ten times above a heavy
session, so they catch loops, not people. Census, HUD and BEA publish no daily cap, so their daily
shares are there to catch runaway use, and their real protection is the per-minute split.

**How the owner changes them:** a `limits` block per server in the fleet record
(`instances.json`, ADR-004), read by `terraform/instances/<name>/locals.tf` into module variables,
set on the Lambda as one `FEDERAL_MCPS_LIMITS` JSON environment variable (like OpenContext's
config), and on the stage and function as the throttle and concurrency. The module variables carry
the defaults above, so `instances.example.json` and self-hosters get them without writing any. A
change is an edit and a `scripts/deploy.sh` run, the deliberate act ADR-007 asks for. Stdio and
self-hosted runs without the variable have no limiter, as today. The alternative, a config item in
the DynamoDB table that the owner edits live, avoids a redeploy but moves configuration out of the
reviewed record; it is decision 7's alternative.

**An operator bypass for the eval.** A secret header (a sensitive variable, never documented
publicly) that exempts a request from per-network and pool shares but **not** from the service
budget, so the live eval before a release is never refused by its own limits. Without it, the
eval shares the owner's network allowance.

## Question 6: migration to authentication

The in-app layer is built around one seam: `identify(request) → { key, class, limits }`. Today it
returns the hashed address with class `network`, or the pool with class `hosted_pool`. When
authentication arrives (per-client keys, or OAuth, which claude.ai connectors support and which
would finally give a per-user identity through the Anthropic range), `identify` returns the client
id with class `client` and that client's limits. The counters, the refusal message, the envelope
`limit` block, the metrics and the service budget do not change. The inferred classes remain as
the anonymous tier, so ADR-016's public, no-sign-in endpoints can stay public with lower limits
while keyed clients get more. The edge layer stays as the cost ceiling in both worlds. Nothing
built in M17 is thrown away; the HMAC-keyed network counters simply become the anonymous tier.

## How this meets the data mirror (spike #51, in progress)

The two solve different halves of the same scarcity. The mirror, if built, answers LAUS and CES
(and perhaps more) from a copy instead of the BLS API, so those reads stop spending the 500; this
spike rations what still goes upstream. The interaction is one design rule: **the limiter counts
upstream requests by source, not tool calls by program.** A mirror-served read is then free under
the upstream shares automatically, and only the tool-call ceilings (cost and abuse) still apply to
it. Once the mirror lands, the BLS shares can be raised in the fleet record without code. M17 does
not wait for the mirror, and nothing here constrains its design. The one overlap is caching: a
short fresh TTL on the BLS timeseries (none today) is the cheapest quota saving available, and
it is decision 8 below, so the mirror spike can assume it or supersede it.

## Decisions for the owner

1. **Identity.** *Recommended:* enforce on the source IP from `requestContext` (forwarded by the
   adapter as an internal header, any client copy stripped), with `160.79.104.0/21` as one
   "claude.ai" pool with a larger allowance, stored only as a daily HMAC; `User-Agent` and
   `clientInfo` as metric labels only. *Alternatives:* IP only with no pool (claude.ai users get
   random per-address limits); no per-identity limit at all, only the service budget and the edge.
2. **Layers.** *Recommended:* the four-part minimum above: edge throttling and reserved concurrency;
   in-app DynamoDB counters for the BLS service budget and per-identity daily shares; per-minute
   limits by split for HUD and BEA with a BEA error limiter; input caps. No WAF now. *Alternatives:*
   (a) edge only, with the in-memory budget kept (cheapest, no admin table, but no totals and no
   fair share); (b) add the CloudFront flat-rate Free plan's per-IP limiting now; (c) migrate to
   REST APIs for WAF and usage plans.
3. **Behaviour when DynamoDB fails.** *Recommended:* fail open for per-identity shares, and fall back
   to the in-memory budget for the service budget, logging a `limiter_degraded` metric that alarms.
   *Alternative:* fail closed (a DynamoDB outage takes the servers down).
4. **What a limited caller gets.** *Recommended:* stale cache first; otherwise an `isError` result
   with the plain sentence and reset time, plus an envelope-shaped `structuredContent` carrying a
   `limit` block, enforced by a new contract rule; an 80% warning limitation; limits in
   `describe_source`. *Alternative:* text-only errors as today (no contract change).
5. **Monitoring.** *Recommended:* the EMF log line, the lean 25 metrics, one dashboard, about ten
   alarms, an AWS Budgets cost alert, SNS email to the owner; about $5–9 a month. *Alternatives:*
   add per-tool metric dimensions (+$8); or free AWS metrics and alarms only (no upstream-budget
   view, about $1).
6. **Default limits.** *Recommended:* the table in question 5. *Alternative:* start at half of it
   for the first month and raise from observed use.
7. **Where limits are configured.** *Recommended:* the fleet record → Terraform → one environment
   variable, changed by a deploy. *Alternative:* a live config item in the DynamoDB table.
8. **BLS timeseries cache and input caps.** *Recommended:* a 12-hour fresh TTL on BLS API responses
   (stale served on failure), `bls_get_raw` capped at 200 ids, QCEW on its own budget key.
   *Alternative:* leave caching to the mirror spike.
9. **Operator bypass for the eval.** *Recommended:* yes, a secret header exempting shares but not
   the service budget. *Alternatives:* allow-list the owner's address; no bypass.
10. **The administrator step.** *Recommended:* one new idempotent script,
    `scripts/admin-grant-protection.sh <instance>`, run once by an administrator: it creates the
    `rc-federal-mcps-<env>-limits` table (on demand, TTL on `expiresAt`), adds `dynamodb:UpdateItem`/
    `GetItem` on that table to each execution role's inline policy, grants `rc-deploy` the
    CloudWatch, SNS and Budgets rights on `rc-*` names for the monitoring module, activates the
    `project` cost-allocation tag, and reports the account's Lambda concurrency so reserved
    concurrency can be set safely. *Alternative:* widen `rc-deploy` to create the table itself
    (fewer admin runs later, a broader standing grant).
11. **Privacy policy.** *Recommended:* update `privacy.md` in the build PR: hashed, daily-rotated
    network counters kept at most two days; the per-call log line's fields; no arguments logged.
12. **The v1.0 gate.** ADR-012 reserved 1.0.0 for "the day the API is committed stable".
    *Recommended:* v1.0.0 when M17 is deployed and verified per SHA, the live eval passes with the
    limiter on (through the bypass), a live test shows a limit refusal with its message and reset,
    and the owner commits the family verbs and envelope (including the new `limit` block) as stable.
    ADR-016 §2's alias hostnames stay, since their removal needs a notice one minor version ahead.
    *Alternative:* ship M17 as v0.9.0 and cut 1.0.0 after a month of observed limits.

## Proposed build cut (after the rulings; not filed)

M17, epic "Public-use protection (v1.0)", each issue on the board and a sub-issue of the epic:

1. **ADR-020** encoding the rulings.
2. **Terraform edge layer:** `throttling_rate_limit`, `throttling_burst_limit` and
   `reserved_concurrency` variables on all six modules, fed from the fleet record's `limits`, with
   `terraform test` assertions (decision 2).
3. **Admin script** `admin-grant-protection.sh`, with its runbook section (decision 10).
4. **Core caller identity:** the adapter forwards `requestContext.http.sourceIp` as an internal
   header and strips client copies, in all five Node adapters; `ToolContext.caller` from the shell;
   the pool range; the HMAC (decision 1).
5. **Core persistent limiter:** a DynamoDB `BudgetStore` and per-identity counters behind the
   existing interface (conditional `ADD`, keyed by source and day), an in-memory short-circuit once
   an identity is over its limit so refusals cost no write, fail-open behaviour, and QCEW on its own
   key; tests against a fake store, no AWS in unit tests (decisions 3, 8).
6. **Refusal and discovery:** the envelope-shaped limit error, the contract rule, the 80% warning,
   `describe_source` limits (decision 4).
7. **Upstream per-minute split and input caps:** `perMinute` from configuration divided by reserved
   concurrency, the BEA error limiter, the `bls_get_raw` id cap, the BLS timeseries TTL if ruled in
   (decision 8).
8. **Monitoring module:** the EMF line in the shell, dashboard, alarms, SNS topic, AWS Budget
   (decision 5).
9. **Docs and release:** `privacy.md`, a "Limits" section in `connect.md`, `architecture.md`
   (the budget line and the drifted deploy paragraph), the runbook for changing limits, the
   operator-bypass variable, a `LIVE_TESTS=1` smoke test that provokes a refusal, owner deploy,
   live eval, v1.0.0 (decisions 9, 11, 12).

Issues 2 and 3 unblock everything else; 4 and 5 are the core of the milestone and share a seam
(the limiter interface) that should be written first by whoever integrates.

## Not verified

- **Live traffic.** `rc-deploy` cannot read access logs or metrics, so no request counts, address
  counts or durations were observed; the sizing rests on code and the eval sets.
- **Whether `rc-deploy` can create** a DynamoDB table, dashboard, alarm, SNS topic, web ACL or
  CloudFront distribution, or set reserved concurrency; only list and read calls were tried.
- **The account's Lambda concurrency limit** (and so whether 100 unreserved remain after
  reserving 24 across six functions).
- **What an HTTP API returns when the Lambda is throttled** by reserved concurrency (a `429` or a
  `5xx`), and how claude.ai and Claude Code show it; a deploy-time test should settle it.
- **How Anthropic spreads calls across `160.79.104.0/21`**, the `User-Agent` and `clientInfo` that
  claude.ai and Claude Desktop send, and whether Claude Desktop's custom connectors also come from
  that range (believed, since they are configured through claude.ai).
- **BLS's reset clock** for the 500 a day (UTC or Eastern), hence the 10 held back.
- **SNS email pricing** (the page read on 2026-09-30 did not show the email free tier; SNS has
  historically included 1,000 email notifications a month free). The Lambda Arm per-GB-second rate
  was taken from the pricing page's table rather than a quoted sentence.
- **Whether one CloudFront flat-rate distribution can front six hostnames** with different origins,
  and how many of the account's three free plans are already in use.

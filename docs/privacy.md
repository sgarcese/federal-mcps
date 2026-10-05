# Privacy policy — federal-mcps connectors

**Status:** current · applies to every hosted connector in the family (BLS, Census, HUD User,
BEA and the geography server, plus the CDC OpenContext portal) and to the same servers run
locally over stdio. Last updated 2026-10-05 (M17, ADR-020 §11).

These connectors serve published federal statistics, organized by place. They are read-only
and have no accounts, no sign-in, and no user profiles.

## What the connector receives

Only the arguments of the tool call your MCP host sends: a place name or identifier, an
indicator name, optional series or variable ids, years, and similar query parameters. The
connector never requests, reads, or stores your conversation, chat history, memory, uploaded
files, or any other content from your Claude session or other host.

## What is stored

- **Request logs.** The hosted endpoints run on AWS (API Gateway and Lambda in the Responsive
  City account). API Gateway access logs record the request id, HTTP status, route, source IP
  address, and any integration error. Lambda logs record server diagnostics (for example a
  missing configuration warning). Tool arguments and responses are not written to logs by the
  application. Logs are retained for **30 days** and then deleted automatically.
- **Response cache.** Upstream agency responses are cached in server memory to stay within each
  agency's API quota: answered fresh for a day (BLS timeseries) to 30 days (QCEW, Census, HUD),
  and kept a while longer to answer when an agency is down or a limit is spent, until the
  server instance recycles. The cache is keyed by the request itself, not by who asked, and holds only public
  statistics.
- **Per-network fair-use counters (M17, ADR-020).** To keep the shared endpoints usable for
  everyone without requiring sign-in, each server counts tool calls and upstream queries
  per day against a daily share. The counter is keyed not on your address but on a
  **daily-rotating HMAC of the source address** — a one-way digest that changes every day at
  UTC midnight, computed with a secret the servers hold and never expose. The address itself
  is never written to the counter, logged, or returned to any caller. Counters are stored in
  DynamoDB and expire **two days after the UTC day they count ends** (DynamoDB then deletes
  expired items automatically, usually within a day or two). The **claude.ai egress range** (`160.79.104.0/21`) is counted as one
  shared pool rather than as individual addresses, because every claude.ai user's request
  arrives from that one range; this means a heavy claude.ai day can affect other claude.ai
  users' shares, which [`connect.md`](connect.md) names as the design's known weak point. A
  `User-Agent` string may be recorded as a metric label (to show how traffic splits by host)
  but is never used to identify or enforce a limit on you.
- **A per-call metrics line (M17, ADR-020 §5).** Each tool call produces one
  structured log line for operational metrics: which server and tool were called, the outcome
  (success, tool error, or which kind of limit refused it), how long it took, how many upstream
  requests it made, whether the answer came from cache, and which scope (if any) a limit
  applied to. **Tool arguments are never part of this line** — no place name, no series id, no
  free-text input — because a free-text argument could hold anything, and this policy promises
  arguments are not logged. Neither the raw source address nor the hashed counter key appears
  in it.
- **An operator-bypass token.** A sensitive, internal credential lets the project's own release
  checks (the eval run before a deploy) skip the per-network and claude.ai-pool shares without
  spending them on behalf of real users. It is configured as a deploy secret, never committed,
  and its value is never logged or printed; this policy states that it exists, not what it is.

Nothing else is stored. There is no database of users or queries. The API Gateway access
logs above are the only place a source address appears (for 30 days); the fair-use counters
and the metrics line never contain one, and a counter key can be linked to an address only on
the day it was written, and only with the HMAC secret.

## Third parties

To answer a query a connector calls the public government data source(s) it serves — for
example the BLS Public Data API (`api.bls.gov`) and the QCEW open data feed (`data.bls.gov`)
for the BLS server, using the connector's own registration key; similarly for Census, HUD User
and BEA. Geography lookups are answered from a catalog bundled with the server, built from
public Census, OMB and agency reference tables, so they call no third party at all.

Your place and indicator parameters are sent to the relevant agency as part of those requests.
No data is sold, shared with advertisers, or used for any purpose other than answering your
query.

## Data retention summary

| Data | Where | Retained |
|---|---|---|
| API Gateway access logs (request id, status, route, source IP) | AWS CloudWatch Logs | 30 days |
| Lambda diagnostic logs | AWS CloudWatch Logs | 30 days |
| Per-call metrics line (server, tool, outcome, latency, upstream calls, cache hit, limit scope; never arguments) | AWS CloudWatch Logs (EMF) | 30 days |
| Per-network fair-use counters (daily HMAC of the source address, never the address) | DynamoDB | Two days after the day counted |
| Cached upstream responses | Server memory | Until the server instance recycles |
| Conversation content, files, memory | Never received | — |

## Your choices

The connectors need no account, so there is nothing to delete on request beyond the
automatically expiring logs and counters. You can disconnect any of them from your host at any
time; no data persists about you afterwards. If a daily share is exhausted, `describe_source`
on that server shows the configured limits and when they reset — see
[`connect.md`](connect.md#limits) for what a limited answer looks like.

## Contact

Questions about this policy: open an issue at
<https://github.com/sgarcese/federal-mcps/issues> or write to the maintainer listed in the
repository's `README.md`. Changes to this policy are recorded in the repository history.

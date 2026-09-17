# Privacy policy — federal-mcps BLS connector

**Status:** current · applies to the hosted connector at `https://bls-mcp.responsive.city/mcp`
and to the same server run locally over stdio. Last updated 2026-09-17.

This connector serves published statistics from the U.S. Bureau of Labor Statistics (BLS),
organized by place. It is read-only and has no accounts, no sign-in, and no user profiles.

## What the connector receives

Only the arguments of the tool call your MCP host sends: a place name or identifier, an
indicator name, optional series ids, years, and similar query parameters. The connector never
requests, reads, or stores your conversation, chat history, memory, uploaded files, or any
other content from your Claude session or other host.

## What is stored

- **Request logs.** The hosted endpoint runs on AWS (API Gateway and Lambda in the Responsive
  City account). API Gateway access logs record the request id, HTTP status, route, source IP
  address, and any integration error. Lambda logs record server diagnostics (for example a
  missing configuration warning). Tool arguments and responses are not written to logs by the
  application. Logs are retained for **30 days** and then deleted automatically.
- **Response cache.** Upstream BLS responses are cached in memory for the life of a server
  instance to stay within the BLS API quota. The cache is keyed by the BLS request, not by
  who asked, and holds only public statistics.

Nothing else is stored. There is no database of users or queries.

## Third parties

To answer a query the connector calls two public government data sources:

- the BLS Public Data API (`api.bls.gov`) and the QCEW open data feed (`data.bls.gov`), using
  the connector's own BLS registration key; and
- no others. Geography lookups are answered from a catalog bundled with the server, built
  from public Census, OMB and BLS reference tables.

Your place and indicator parameters are sent to BLS as part of those requests. No data is sold,
shared with advertisers, or used for any purpose other than answering your query.

## Data retention summary

| Data | Where | Retained |
|---|---|---|
| API Gateway access logs (request id, status, route, source IP) | AWS CloudWatch Logs | 30 days |
| Lambda diagnostic logs | AWS CloudWatch Logs | 30 days |
| Cached BLS responses | Server memory | Until the instance recycles |
| Conversation content, files, memory | Never received | — |

## Your choices

The connector needs no account, so there is nothing to delete on request beyond the
automatically expiring logs. You can disconnect it from your host at any time; no data
persists about you afterwards.

## Contact

Questions about this policy: open an issue at
<https://github.com/sgarcese/federal-mcps/issues> or write to the maintainer listed in the
repository's `README.md`. Changes to this policy are recorded in the repository history.

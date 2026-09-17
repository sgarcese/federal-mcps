# Connect the BLS server

**Status:** current · a copy-paste quickstart for city and state policy staff. No
account, no API key, no install — the server answers over the public internet and serves
only public Bureau of Labor Statistics data. Developers who want a local stdio process
instead want [`install.md`](install.md).

The one thing to copy is the URL:

```
https://bls-mcp.responsive.city/mcp
```

Add it once, as a **connector**, and Claude can pull federal labor statistics for a place
straight into the conversation.

## Claude.ai (web and desktop)

1. Open **Settings → Connectors**.
2. Click **Add custom connector**.
3. Paste `https://bls-mcp.responsive.city/mcp` and save.

Leave the authentication fields blank — there is none. The connector is ready in the same
conversation.

## Claude Code

One command from any terminal:

```bash
claude mcp add --transport http bls https://bls-mcp.responsive.city/mcp
```

`bls` is just the local name you'll see it under; call it anything. Check it landed with
`claude mcp list`.

## Any other MCP host

The server speaks **MCP over stateless Streamable HTTP**. Any host that accepts a remote
MCP endpoint takes the same URL — point it at `https://bls-mcp.responsive.city/mcp`, no
auth, and you're connected.

## What to ask

Two steps: **resolve the place, then read a number.** A place name like "Denver" can mean
the county, the city, or the metro area, so the server hands back the choices instead of
guessing — you pick, then ask for the statistic.

> **You:** What's the unemployment rate in Denver?
>
> **Claude:** Denver resolves to a few places — Denver County, Denver city, or the Denver
> metro area. Which did you mean?
>
> **You:** The county.
>
> **Claude:** 4.3% for July 2026 (Local Area Unemployment Statistics, series
> LAUCN080310000000003), with a BLS citation you can paste into a report.

The same pattern answers payroll employment, occupational wages, consumer prices, job
openings, and quarterly employment-and-wage counts. To compare places, name them
together — "compare unemployment across Colorado, Utah, and Nevada" — and the answer lines
them up on the latest period they all share.

Not sure what's available for your town or state? Ask "what can the BLS server tell me
about \<place\>?" — that runs `bls_list_indicators` (what publishes at that level) and
`bls_describe_source` (coverage, cadence, and the data's vintage).

## What you'll notice

The server is built to never hand you a number without its caveats:

- **It asks before guessing.** Ambiguous place, ambiguous geography level — it stops and
  offers the choices rather than silently picking one.
- **It says when a figure stands in for another.** A city under 25,000 people has no local
  unemployment estimate, so it reads the surrounding county; a place with no local price
  index reads the U.S. city average. Either way the answer is **flagged** as a stand-in,
  never passed off as the exact place.
- **It carries the fine print.** Preliminary values, suppressed cells, the reference
  period, and BLS footnotes travel with every number — and a ready-to-cite source line
  comes with it.
- **It never invents a value.** If BLS doesn't publish it, the server says so instead of
  filling the gap.

That's the whole point: numbers you can put in front of a council or a grant reviewer,
with the provenance already attached.

# Connect the servers

**Status:** current · a copy-paste quickstart for city and state policy staff. No
account, no API key, no install — the servers answer over the public internet and serve
only public federal statistics (BLS, Census, HUD User, BEA). Developers who want a local stdio process
instead want [`install.md`](install.md).

The one thing to copy is the URL — one per server:

```
https://bls.responsive.city/mcp        # BLS: unemployment, jobs, wages, prices
https://census.responsive.city/mcp     # Census: population, income, poverty, housing (ACS + 2020 count)
https://hud-user.responsive.city/mcp   # HUD User: Fair Market Rents, Income Limits, CHAS cost burden, subsidized housing
https://bea.responsive.city/mcp        # BEA: personal income, GDP by industry, regional price parities
https://geo.responsive.city/mcp        # Geography: resolve any place name to its identifiers and parents
https://cdc.responsive.city/mcp        # CDC open data (data.cdc.gov via OpenContext) — load skills/cdc-places for PLACES

(The original `bls-mcp`, `census-mcp` and `geo-mcp` hostnames keep working as aliases; ADR-016.)
```

Add it once, as a **connector**, and Claude can pull federal labor statistics for a place
straight into the conversation.

## Claude.ai (web and desktop)

1. Open **Settings → Connectors**.
2. Click **Add custom connector**.
3. Paste `https://bls.responsive.city/mcp` and save.

Leave the authentication fields blank — there is none. The connector is ready in the same
conversation.

## Claude Code

One command from any terminal:

```bash
claude mcp add --transport http bls https://bls.responsive.city/mcp
claude mcp add --transport http census https://census.responsive.city/mcp
claude mcp add --transport http hud https://hud-user.responsive.city/mcp
claude mcp add --transport http bea https://bea.responsive.city/mcp
```

`bls` is just the local name you'll see it under; call it anything. Check it landed with
`claude mcp list`.

## Any other MCP host

The server speaks **MCP over stateless Streamable HTTP**. Any host that accepts a remote
MCP endpoint takes the same URLs — point it at `https://bls.responsive.city/mcp` or
`https://census.responsive.city/mcp`, `https://hud-user.responsive.city/mcp` or
`https://bea.responsive.city/mcp`, no auth, and you're connected (the HUD and BEA servers hold their
own agency keys; you need none).

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
openings, quarterly employment-and-wage counts, and national producer prices. To compare
places, name them together — "compare unemployment across Colorado, Utah, and Nevada" —
and the answer lines them up on the latest period they all share.

You can narrow most of these. Ask for "food inflation in Denver" or "energy prices in the
Boston metro" (CPI by expenditure group); "construction wages in Denver County" or
"private-sector manufacturing employment in Colorado" (QCEW by industry and ownership);
"what do healthcare practitioners earn in the Denver metro" (OEWS by occupation group); or
"how have lumber and steel prices moved" (PPI — national only, and the answer says so if
you name a place). The server publishes each vocabulary through `bls_list_indicators`, so
Claude picks the right code rather than guessing.

The Census server answers the demographic side: "what is the median household income in
Sedona?", "poverty rate in Suffolk County", "how many people did the 2020 Census count in
Denver?". Every American Community Survey number comes with its margin of error and a
reliability grade, and the answer says whether it is a 1-year estimate (places of 65,000 or
more) or a 5-year one (everywhere else, covering a five-year period). This product uses the
Census Bureau Data API but is not endorsed or certified by the Census Bureau.

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

## Limits

The endpoints are **free and require no sign-in**, but because anyone can reach them, each
server applies daily fair-use limits so one heavy session or a runaway script cannot crowd out
everyone else (M17, ADR-020). You will not notice them in ordinary use.

**The defaults** (per server, UTC days; BLS's numbers shown, others are larger because those
agencies publish no daily cap of their own):

| Share | BLS | Census / HUD / BEA |
|---|---|---|
| Upstream queries, per network | 100 a day | 1,000 a day |
| Upstream queries, the claude.ai pool | 250 a day | 3,000 a day |
| Tool calls, per network | 500 a day | 500 a day |
| Tool calls, the claude.ai pool | 5,000 a day | 5,000 a day |

A "network" is whoever is calling from one address — typically you, or everyone behind one
office's shared internet connection. These ceilings sit well above a normal working session
(a handful of questions is a handful of tool calls); they exist to catch loops and scripts, not
people.

**What a limited answer looks like.** If a share is close to spent, the server reaches for a
cached answer first — you may see a note that the number came from cache rather than a fresh
query, with the reason. If there is truly nothing left to serve, you get a plain sentence
instead of a silent failure or an invented number, for example:

> bls: this network has used its 100 BLS queries for today; resets at
> 2026-10-06T00:00:00Z. Tools that need no new query (resolve_place, list_indicators,
> describe_source) still work.

The sentence always says what was limited, whose share it was, and when it resets — Claude can
relay that to you directly, and the tools that need no new upstream query keep working in the
meantime.

**Check the current limits.** Every server's `*_describe_source` tool (e.g. `bls_describe_source`)
reports a `limits` block with the configured shares and, where tracked, how much of today's
budget remains — ask "what are the BLS server's limits right now?" at any time.

**The claude.ai pool is one shared bucket — this is a known limitation.** Every claude.ai user's
request arrives from the same published IP range, so the servers cannot tell one claude.ai user
from another; they are all counted against one pool share. A very heavy day of claude.ai traffic
can mean other claude.ai users see cached or limited answers sooner than they otherwise would.
Claude Code and other hosts that connect directly from your own machine or office each get their
own per-network share, independent of claude.ai's pool. The fix for this weak point is
authentication, which is not yet built; until then, lowering the pool's limits is the owner's
only lever.

**Heavy, regular use?** If your organization expects to run many queries a day, every server in
this family is open source and can be self-hosted in your own AWS account with higher (or no)
limits — see [`install.md`](install.md) to run a server locally, or
[`docs/runbooks/bootstrap-instance.md`](runbooks/bootstrap-instance.md) to deploy your own
instance.

# Directory-submission readiness (M6.3, #138)

**Status:** current · the Anthropic connector review criteria used as the project's **quality
and reliability bar** (ADR-012 §3 as amended 2026-09-17: no directory submission is planned),
plus the portal fields drafted before that ruling, kept for reference. Checked
2026-09-17 against Anthropic's [pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria),
[submission guide](https://claude.com/docs/connectors/building/submission) and
[Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy).
Re-run this pass before each submission; the criteria pages change.

The project is not submitting to the directory (owner ruling, 2026-09-17). Rows marked
"Owner decision" or "Owner" below were submission prerequisites and are moot; the remaining
rows are re-run as a checklist before each release alongside the eval set.

## Checklist

Evidence column names the test, rule, or document that proves the item. "Rule" = a rule id in
the family contract suite (`packages/core/src/testing/rules`, run by `npm run test:contract`
on every PR).

| # | Criterion (Anthropic's wording, condensed) | Status | Evidence |
|---|---|---|---|
| 1 | Separate read and write tools; no catch-all `api_request` with a `method` parameter | Pass | Every tool is read-only by construction; the shell owns annotations and no definition can set them (`create-server.ts`). |
| 2 | Every tool includes a `title` and the applicable `readOnlyHint` / `destructiveHint` | Pass (code) · **pending deploy** | Rule `tool-title` (#138); shell sets `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true` on every tool (`create-server.test.ts` "advertises a title on every tool", "sets the family annotations"). The live endpoint advertises titles only after the next deploy — re-check with MCP Inspector (§ Test connection). |
| 3 | Tool names ≤ 64 characters | Pass | Rule `tool-name-format` (lower snake case, ≤ 64); longest name is `bls_list_indicators` (19). |
| 4 | Narrow, accurate descriptions that match actual behaviour | Pass | Rule `tool-description` (non-empty, ≤ 1,000 chars); `get-indicator.test.ts` "tool descriptions match what the server actually serves" asserts `bls_get_indicator` and `bls_list_indicators` name all six programs and `bls_get_raw` is not described as LAUS-only (all three were stale before #138). |
| 5 | Custom query tools reference the target API | Pass | `bls_get_raw` names the BLS Public Data API and takes series ids only, no free-form paths or bodies. |
| 6 | No prompt-injection patterns in tool descriptions (no calling other tools, no external behavioural instructions, no hidden text, no product promotion) | Pass | Descriptions state what each tool does. Behavioural guidance (resolve the place first, cite the number) lives in the server `instructions`, which describe this server's own data and coverage; none of it references other tools or external sources. Reviewed by reading `definition.ts` and every `description:` in `get-indicator.ts` and `geography/tools.ts`. |
| 7 | Every tool returns a successful response on valid input; no generic errors | Pass | Rule `examples-run` calls every tool with its worked example and validates the envelope; live eval `docs/evals/boston.jsonl` (18/18 on 2026-09-17) exercises every tool against the deployed server. Errors render through `server/errors.ts` with the agency, tool and cause. |
| 8 | Validate inputs; actionable error messages | Pass | The SDK validates each tool's Zod schema before the handler runs; ambiguous, not-found and unavailable places come back as structured statuses with an explanation, never a bare failure. |
| 9 | Responses reasonably sized | Pass | `get_indicator` returns the latest ~13 observations; `compare_places` is capped at 20 places; `resolve_place` returns ranked candidates, not the catalog. |
| 10 | Collect no conversation data; never query Claude memory, history, summaries or files | Pass | Tools receive only their arguments; nothing reads host context (`privacy.md`). |
| 11 | Authentication: OAuth 2.0 for authenticated services | N/A | No authentication; public data. Declared as "no authentication" in the portal. |
| 12 | Privacy policy: clear, accessible link covering collection, use/storage, third-party sharing, retention, contact | Pass | [`docs/privacy.md`](privacy.md) (new in #138). Public HTTPS URL on GitHub. |
| 13 | Public documentation with setup and usage | Pass | [`docs/connect.md`](connect.md) (#137): per-host setup and what to ask. |
| 14 | API ownership: call your own first-party APIs or ones you legitimately proxy; server domain should match your service | **Owner decision** | The connector calls BLS's public-domain statistical API, which the project does not own. It runs on the project's own domain (`bls-mcp.responsive.city`), adds the geography resolver, envelope and coverage logic BLS does not offer, and uses public data under BLS's published API terms. The portal's Data-handling step asks this directly ("a third party's you don't control"); answer it truthfully. If the reviewers reject on this ground, ask `mcp-review@anthropic.com` whether public-domain government data qualifies as legitimately proxied. |
| 15 | Unsupported use cases (financial transfers, AI media generation) | Pass | Neither applies. |
| 16 | Test credentials for a fully populated account | N/A | No accounts. State this in Test & launch; the reviewer connects with the URL alone. |
| 17 | Every tool exercised via MCP Inspector and as a custom connector in Claude | Pass | Custom connector: the owner's Claude.ai account has the server connected and it answers in conversation. Inspector: `npx @modelcontextprotocol/inspector --cli https://bls-mcp.responsive.city/mcp --transport http --method tools/list` lists all six tools with annotations (2026-09-17); the eval runner calls every tool over the same transport. |
| 18 | Maintain security and functionality; respond to security issues; accurate descriptions | Pass | CI gates on every PR (lint, typecheck, tests, contract suite, gitleaks, Terraform validate); issues are public on GitHub. |
| 19 | Allowed link URIs (`ui/open-link`) | N/A | The server opens no links. |
| 20 | Listing assets: icon; screenshots only for MCP Apps | **Owner** | An icon is required in the Listing step; none exists in the repo yet. Not an MCP App, so no screenshots. |

## Test connection

Run before submitting, after the deploy that carries #138:

```bash
npx @modelcontextprotocol/inspector --cli https://bls-mcp.responsive.city/mcp \
  --transport http --method tools/list
npm run eval
```

Expect six tools, each with `title` and `annotations.readOnlyHint: true`, and the eval set at
or above the 90 % bar with zero fabricated values. Then confirm the custom connector in
Claude.ai still answers "What's the unemployment rate in Denver County?" with a citation.

## Portal fields (draft)

The portal syncs tools from the connected server; these are the free-text fields. Limits are
the portal's.

| Field | Draft |
|---|---|
| Connection | `https://bls-mcp.responsive.city/mcp`, streamable HTTP, one Universal URL |
| Server name (≤ 100) | BLS Labor Statistics by Place |
| Tagline (≤ 55) | Federal labor and price statistics for any U.S. place |
| Description (≤ 2,000) | See below |
| Categories (1–5) | Data & analytics; Government / public sector; Research (pick from the portal's list) |
| Documentation URL | `https://github.com/sgarcese/federal-mcps/blob/main/docs/connect.md` |
| Privacy policy URL | `https://github.com/sgarcese/federal-mcps/blob/main/docs/privacy.md` |
| Support contact | Owner's email (also the repository issues page) |
| Icon | **To create** |
| URL slug | `bls-labor-statistics` (permanent once published) |
| Use cases | Local unemployment, payroll employment, wages, prices, job openings and covered employment for a city, county, metro or state, with citations; peer comparison across places; coverage questions ("does BLS publish this for my town?"). |
| Prerequisites | None — no account, no key. |
| Reads / writes | Reads only. |
| Company | Owner's name and `https://github.com/sgarcese/federal-mcps` |
| Authentication | No authentication. |
| Data handling | Underlying API is a third party's the project does not control (U.S. Bureau of Labor Statistics, public domain). No personal health data. No sponsored content. |
| Test & launch | No credentials needed: connect the URL and call any tool. Confirm every tool was run via Inspector and as a custom connector (checklist #17). |
| Compliance | Acknowledge all seven: directory guidelines, first-party API usage (see checklist #14), no financial transactions, no AI media generation, no prompt injection, no conversation-data collection, public documentation. |

### Description (draft, 1,180 characters)

> Ask for federal labor market and price statistics for any place in the United States and
> get the number with its citation. The connector serves six Bureau of Labor Statistics
> programs — Local Area Unemployment Statistics (unemployment rate, employment, labor force),
> Current Employment Statistics (payroll employment), Occupational Employment and Wage
> Statistics, the Consumer Price Index, Job Openings and Labor Turnover, and the Quarterly
> Census of Employment and Wages (covered employment, average weekly wage) — for states,
> counties, metro areas and cities.
>
> It resolves place names first, so "Denver" comes back as a choice between the county, the
> city and the metro area rather than a guess. Where BLS does not publish at a level — a city
> under 25,000, a metro with no local CPI — it returns the nearest published geography and
> says so, never an invented local figure. Every answer carries the BLS series id, retrieval
> date, footnotes (preliminary, revised, suppressed) and a ready-to-paste citation. Compare one
> indicator across up to twenty places on the latest period they share.
>
> Built for city and state policy staff. No account or key; public data only; read-only.
> Open source (Apache-2.0): github.com/sgarcese/federal-mcps.

## Open items before submitting

1. Deploy the #138 build so the live `tools/list` carries titles; re-run § Test connection.
2. Rule on checklist #14 (API ownership) and be ready to answer the Data-handling step as
   "third party's you don't control".
3. Create the listing icon.
4. Confirm the submitting Claude.ai organization is on a Team or Enterprise plan with directory
   access for the owner.
5. Cut v0.1.0 (#139) first so the listed server reports a real version, not `0.0.0`.

# Spike: a hosted data mirror with push-down queries (#51)

Issue #51, first raised as a LABSTAT mirror behind the BLS server (ADR-009 §2, deferred), widened by
the owner on 2026-09-17 (a Hugging Face dataset, also hosting the Geocorr crosswalks), ruled deferred
the same day ("revisit when quota or freshness actually binds"), and extended on 2026-09-24 (push
filtering and aggregation down to our own data) and 2026-09-30 (OEWS history). This spike asks what
binds today, what a mirror would hold, where it would live, how a tool would query it safely, and
what the smallest useful first step is. Everything marked *measured* was checked on 2026-09-30
against `main` at `761dc97` (v0.8.0) and the agencies' own servers; nothing called the BLS API with
the project's key. The spike ends in decision questions; no issue is filed before the owner rules.

## Summary

- **The quota has not been shown to bind, and today it cannot be shown either way.** The servers
  record no upstream-call counts; the budget counter lives in memory per Lambda container.
- **Coverage binds now, concretely: OEWS history.** The BLS API and LABSTAT both hold only May 2025.
  May 2019–2024 exist only as BLS's per-year Excel tables. A state-and-metro, major-group history is
  about 0.16 MB of Parquet a year (*measured*) and fits in the Lambda bundle with no new runtime
  dependency.
- **The heaviest upstream path is QCEW history,** not the timeseries API: up to 23 CSV files per
  place per call, each about 276 KB, and those files count against the BLS 500-a-day counter even
  though BLS does not meter them.
- **All the data is small once in Parquet.** Eight LABSTAT programs with full history come to about
  105 MB. A curated labor-market set (LAUS, CES State and Area, QCEW sector-level, OEWS history)
  comes to 200–320 MB. QCEW at full industry detail is what makes an all-programs mirror 5–15 GB.
- **Push-down needs a structured grammar, not SQL text.** Suppressed QCEW cells are published as
  zeros, so a naive `SUM` undercounts silently (*measured*: 3 of 93 Indiana county construction
  rows in 2024).
- **Recommended path:** stage 0, instrument and trim waste; stage 1, bundle the OEWS history;
  stage 2, build the Hugging Face mirror and push-down only when M17's metrics show a need.

## 1. Current pressure, from the code

**How the BLS server spends upstream calls.** `createBlsServer` (`server-bls/src/index.ts`) builds
one core HTTP client per process: `source: "bls"`, `MemoryBudgetStore(500)`, `MemoryCacheStore()`.
Both stores live in the Lambda container's memory. They reset on every cold start and are not
shared between concurrent containers. The architecture doc's "DynamoDB in Lambda" budget store was
never built; the security review's decision 3 (a persistent BLS budget) was deferred by the owner
and now sits in M17 (#297).

| Path | Upstream cost per tool call | Cached? |
|---|---|---|
| `bls_get_indicator`, timeseries programs (LAUS, CES, OEWS, CPI, JOLTS, PPI, CPS) | 1 POST to `api.bls.gov/publicAPI/v2/timeseries/data/` | **No.** `tools.ts` passes no `freshTtlSeconds`, and `fetchSeriesBatches` caches only when given one. Every call spends quota, even a repeat of the previous minute's call. |
| `bls_compare_places`, timeseries | 1 POST for up to 20 places (one batch of ≤50 ids) | No |
| `bls_get_raw` | ⌈ids / 50⌉ POSTs; spans over 20 years are capped (#292) | No |
| QCEW indicator, latest period | 1 to 4 CSV slices (`data.bls.gov/cew/data/api/{y}/{q}/area/{code}.csv`, with up to 3 look-backs) | 30 days (`QCEW_CACHE_TTL_SECONDS`), in memory |
| QCEW indicator with years | up to **23 slices in parallel** (`QCEW_MAX_PERIODS` 20 + look-back 3) per place | 30 days, in memory |
| QCEW compare with years | up to 23 × 20 places = **460 slices** | 30 days, in memory |

A county's QCEW quarter slice is **276,007 bytes** (*measured*: St. Joseph County, IN, 2025 Q1,
1,687 lines, 0.37 s). A 20-county, 5-year comparison therefore pulls up to about 127 MB into a
512 MB Lambda. The slices go through the same `bls` client, so **each slice spends one unit of the
500-a-day counter**, although `data.bls.gov` CSVs are not keyed or metered by BLS. One such
comparison can use most of a fresh container's counter and refuse the next timeseries call with
`QuotaExceededError`, while the real BLS key still has quota.

**When BLS itself refuses.** When the key's daily quota is spent, `parseSeries` meets a
non-success status and throws a generic `Error("BLS API did not succeed: …")`, not
`QuotaExceededError`. The caller sees an opaque failure rather than "quota spent for today".

**What evidence exists.** No log line or metric records upstream calls, cache hits or budget
remaining. The API Gateway access log records only `requestId`, `status`, `ip`, `routeKey` and
`error`, kept 30 days (`terraform/modules/bls-server/main.tf`). Each MCP request is one JSON-RPC
POST to one route, so the access log counts requests but cannot tell a `tools/list` from a
`get_indicator`. No issue, eval run (77/77 live at v0.7.0) or owner trial has reported a BLS quota
refusal. The 2026-09-30 trial found a coverage gap (OEWS history), not a quota error. **Conclusion:
there is no evidence that the quota binds, and no instrument that could show it.** Freshness does
not bind either: the live API is as fresh as BLS.

## 2. Sources and sizes (*measured* 2026-09-30)

**Method.** LABSTAT directory listings were read from `download.bls.gov/pub/time.series/<program>/`,
which answered 200 to a descriptive User-Agent with a contact address (the one
`geography-build/src/download.ts` already uses). Representative files were downloaded, converted
to Parquet with DuckDB 1.5.6 (zstd, sorted by `series_id, year, period`, typed columns), and rows
were counted. Estimates for files not downloaded scale by the measured bytes per row: 55 bytes a
row in every LABSTAT data file checked, 42 for CPI. LABSTAT answered a byte-range request with the
whole file (a 331 MB response to `-r 0-8000000`), so range reads against BLS are not available.

### LABSTAT time series

| Program | Whole-program file(s) | Upstream TSV | Rows | Parquet | Last modified | Basis |
|---|---|---|---|---|---|---|
| LAUS `la` | `la.data.0.CurrentU*` (8 files, 1990→) + `la.data.1.CurrentS` | 855.7 MB | ≈15.6 M | ≈37 MB | 2026-09-30 | Indiana file measured: 343,414 rows, 737 series, 1976–2026, 18.9 MB → 0.83 MB (22.8×) |
| ↳ county only | `la.data.64.County` | 337.1 MB | ≈6.1 M | ≈15 MB | 2026-09-30 | scaled |
| ↳ cities | `la.data.65.City` | 331.2 MB | ≈6.0 M | ≈15 MB | 2026-09-30 | scaled |
| CES State and Area `sm` | `sm.data.1.AllData` | 545.7 MB | ≈9.9 M | ≈20 MB | 2026-09-18 | Indiana measured: 257,060 rows, 598 series, 1939–2026, 14.1 MB → 0.51 MB (27.7×) |
| CES national `ce` | `ce.data.0.AllCESSeries` | 351.1 MB | ≈6.4 M | ≈13 MB | 2026-09-11 | scaled at the SM ratio |
| OEWS `oe` | `oe.data.0.Current` (= `oe.data.1.AllData`, same size) | 331.5 MB | **6,023,970, all May 2025** | **23.9 MB** | 2026-05-15 | fully measured: one row per series, 13.9× |
| CPI `cu` | `cu.data.0.Current` (1997→) | 49.0 MB | 1,167,677 | 3.9 MB | 2026-09-11 | fully measured: 7,936 series |
| JOLTS `jt` | `jt.data.1.AllItems` (2000→) | 34.5 MB | 627,672 | 0.8 MB | 2026-09-29 | fully measured: 2,060 series |
| PPI commodity `wp` | `wp.data.0.Current` | 71.8 MB | ≈1.3 M | ≈3–4 MB | 2026-09-10 | scaled |
| PPI industry `pc` | `pc.data.0.Current` | 64.5 MB | ≈1.2 M | ≈3 MB | 2026-09-10 | scaled |
| CPS `ln` (national, #290) | `ln.data.1.AllData` | 390.5 MB | ≈7.1 M | ≈15 MB | 2026-09-04 | scaled |

**Eight programs the server serves, full history: about 105 MB of Parquet** (≈120 MB with CPS).
LABSTAT has 68 program directories. The other 58 were not measured; none of them is served today.

**Release cadence, from the listings.** Each program's files are rewritten on its release day at
10:00 AM Eastern: LAUS metro and county on 2026-09-30, JOLTS on 09-29, State and Area on 09-18,
CPI and CES on 09-11, PPI on 09-10, OEWS on 05-15 (annual). Every data file served had an `ETag`
and `Last-Modified` header (*measured*: `la.data.64.County`), so an ETag-keyed manifest works
against LABSTAT as it does against USAspending.

**Caveats arrive as footnote codes, per row.** LAUS (`la.footnote`, *measured*): `P` preliminary
(736 Indiana rows, the latest month), `X` "Data unavailable due to the 2025 lapse in
appropriations" (737), `G` "Annual estimates for 2025 are 11-month averages that exclude October"
(731), and `A`, `N`, `U`, `V`, `W`, `Y`. SM: `P` preliminary, `C` correction. CPI: `R` revised,
`X`. OEWS: `4` hourly-or-annual, `5` top-coded wage (≥ $115.00 an hour), `8` "Estimate not
released" (88,052 rows), and 191,336 values published as `-`. A mirror must carry the code column,
and the footnote table per program, or it drops caveats that CLAUDE.md requires to travel.

**Revisions** (from `la.txt`): each monthly LAUS release revises the prior month, and "annual
revisions typically result in updates to data for the preceding five years by mid-April of the
following year". CES has an annual benchmark as well. A mirror that is not rebuilt after a
benchmark serves superseded values. The refresh must rewrite whole program partitions, never append.

### QCEW bulk files (`data.bls.gov/cew/data/files/{year}/csv/`)

| File (2024) | Zip size | Notes |
|---|---|---|
| `2024_annual_singlefile.zip` | 74.7 MB | 520.3 MB CSV, **3,664,909 rows**, 38 columns (headline, `lq_*`, `oty_*`) |
| `2024_annual_by_area.zip` | 136.1 MB | the same data, one CSV per area |
| `2024_qtrly_singlefile.zip` | 304.8 MB | ≈4× the annual |
| `2024_qtrly_by_area.zip` | 414.2 MB | |
| `2025_qtrly_singlefile.zip` | 287.0 MB | modified 2026-08-21 (through Q1 2026) |

All carry `ETag` and `Last-Modified`. The 2024 annual file was measured as Parquet:

| Cut | Rows | Parquet |
|---|---|---|
| Every row, every column | 3,664,909 | 96.2 MB |
| Every row, headline columns only (no `lq_`/`oty_`) | 3,664,909 | 22.1 MB |
| **Curated**: nation, state, MSA and county × total, domain, supersector, sector (agglvl 10–14, 40–44, 50–54, 70–74), headline columns | 228,470 | **2.4 MB** |

For planning: curated annual 2001–2025 is about 60 MB. Curated quarterly 2014–2025 (the span the
server serves, `EARLIEST_QCEW_YEAR`) is about 120 MB. Full-detail QCEW (six-digit NAICS, all years
since 1990, quarterly) is what reaches 5–15 GB. **Suppression is published as zeros**: a
`disclosure_code` of `N` comes with `0` in every value column (*measured*: Dearborn County and Ohio
County, IN, private construction 2024; 3 of Indiana's 93 county rows).

### OEWS history (`www.bls.gov/oes/special-requests/oesm{yy}{st|ma|nat|all}.zip`)

**The gap, verified.** A keyless API call for `OEUS080000000000000000004` (Colorado, all
occupations, annual mean wage) for 2019–2025 returned "No Data Available" for 2019–2024 and only
2025 = $77,190. LABSTAT's `oe` files hold only May 2025. The per-year tables hold the rest: Colorado
**2019 = $57,690** and construction and extraction 2019 = $51,490, read from `state_M2019_dl.xlsx`.
The 2025 table matches the API to the dollar ($77,190; $65,880).

| Year | State zip | Format | Header |
|---|---|---|---|
| 2010 | 3.8 MB | `.xls`, plus a separate `field_descriptions.xls` | upper case, `GROUP`, `LOC QUOTIENT` with a space; no NAICS or area-type columns; 36,566 rows |
| 2019 | 6.8 MB | `.xlsx`, one sheet | **lower case**; adds `area_type`, `naics`, `i_group`, `own_code`, `o_group`, `pct_total`; 36,382 rows |
| 2025 | 7.6 MB | `.xlsx`, 4 sheets | upper case again; adds `PRIM_STATE`, `PCT_RPT`; 37,408 rows |

The 2019 metro zip is 35.5 MB (MSA and non-metro sheets) and the all-data zips run 72.7–80.1 MB a
year. Markers are strings in numeric columns: `*` (wage estimate not available), `**` (employment
estimate not provided), `#` (wage ≥ the top code). Counted in the state files: 2010 `*` 19,046,
`**` 5,328, `#` 5,382; 2025 `*` 22,591, `**` 5,272, `#` 1,114. A parser must map columns by name, per year, and
turn every marker into a null plus a footnote.

**Size.** 2019 state + MSA + non-metro, 9 measure columns typed, all occupations: 225,176 rows,
2.8 MB. Restricted to what `bls_get_indicator` serves (all occupations plus the 22 SOC major
groups, state and MSA): **10,282 rows, 0.16 MB a year.**

**Metro codes are not stable across years.** 36 of the 396 MSA codes in the 2019 table do not
appear in the current `oe.area` list (for example New England codes `0077200`, `0078100`). State
codes are stable. A metro history needs a code-vintage mapping or has to stop at the break.

**Comparability.** BLS documents that OEWS estimates are not designed for comparisons over time:
three-year pooled samples, and the SOC 2018 changeover phased in around May 2019–2021. The mechanics
of the changeover were not verified here. Any year-over-year OEWS answer must carry that caveat.

### Size summary

| Scope | Parquet |
|---|---|
| OEWS history, major groups, state + metro, 2019–2024 | ≈1 MB |
| OEWS history, all detailed occupations, state + metro + non-metro, 2019–2024 | ≈17 MB |
| The eight LABSTAT programs the server uses, full history | ≈105 MB |
| Curated labor-market mirror: LAUS + SM + CES + OEWS 2019→ + QCEW curated annual 2001→ and quarterly 2014→ + CPI/JOLTS/PPI | ≈200–320 MB |
| All programs, including full-detail QCEW | ≈5–15 GB (QCEW dominates; unmeasured beyond one year) |

## 3. Hosting

**Deploy constraints that decide more than the storage does** (*measured* from the current build):
the BLS Lambda zip is **30.7 MB zipped and 124.9 MB unzipped**, of which the geography catalog is
121.2 MB. Terraform uploads it directly (`filename`), which AWS caps at **50 MB zipped**; the
unzipped cap, layers included, is 250 MB. Lambda is arm64, Node 22, 512 MB, 29 s.
**DuckDB for Node** (`@duckdb/node-bindings-linux-arm64` 1.5.6) is 21.7 MB as a tarball and 63.5 MB
unpacked, and its `httpfs` extension (needed for `hf://` and `s3://`) is 7.3 MB gzipped, downloaded
at first use unless bundled. **Adding DuckDB pushes the zip past 50 MB**, which forces an S3-staged
code upload or a layer. rc-deploy cannot create S3 buckets (ADR-006), so that means an
administrator step, and new IAM for a role that is administrator-provisioned.

| | Hugging Face dataset over `hf://` | S3 + DuckDB | Bundled per-deploy snapshot |
|---|---|---|---|
| Storage and cost | Free public storage ("best effort" for free accounts; ≤200 GB a file recommended, <10k entries per folder, <100k files per repo) | Pennies a month; an administrator must create the bucket and grant `s3:GetObject` on each role | None; counts against the 50 MB zipped and 250 MB unzipped caps (≈19 MB and ≈125 MB of headroom today) |
| Read path | DuckDB + `httpfs` range reads through `/resolve/` URLs | DuckDB + `httpfs`, in-region | better-sqlite3 (already in every zip) or DuckDB on local disk |
| Latency (*measured* from a laptop, not Lambda) | loading `httpfs` 1.7 s; row count from the footer of a 757 MB file 1.8 s; a one-column filtered scan over 34 row groups 4.0 s, 74 HTTP requests | lower in-region; not measured | sub-millisecond, as the catalog |
| Rate limits | per 5 minutes, *anonymous per IP*: 3,000 resolver, 500 API (September 2025 table; "subject to change"). Globbing uses the API bucket, the reason Haddad's `serve/` layer exists. A free-account token raises these to 5,000 and 1,000. **Lambda's egress IPs are AWS-shared, so anonymous limits may be shared with strangers (unverified)** | none that matter | none |
| Versioning | git revisions; a reader can pin a commit (`hf://datasets/o/r@<rev>/…`, per DuckDB docs, not tested here) | object keys by snapshot date | the deploy SHA (ADR-007's `deployed <sha>` line) |
| Refresh | scheduled GitHub Actions job with an HF write token in repository secrets; publishing data is not a deploy, so ADR-007 is untouched | the same job would need AWS write credentials in CI, which ADR-007 rules out | a person redeploys; fine for annual data, wrong for monthly |
| Reuse by others | yes: anyone with DuckDB, pandas or `datasets` | no | no |
| New failure modes | HF outage or throttling; needs a live-API fallback | bucket, IAM and administrator steps | none |

**Licensing and attribution.** BLS data are U.S. Government works, public domain under 17 U.S.C.
§ 105, so republishing them on the Hub is allowed; the dataset card uses `license: other` /
`us-government-works`, as Haddad's does. The API Terms of Service still apply to how the envelope
cites (docs/licensing.md): the **retrieval date**, which for a mirror is the snapshot date and not
the tool-call date; the "BLS.gov cannot vouch for the data or analyses derived from these data
after the data have been retrieved from BLS.gov" sentence (already in `bls_describe_source`); and no
modification while citing BLS. That last term means markers become nulls with footnotes, never
imputed values. **Geocorr is different**: MCDC publishes no licence (checked 2026-09-18), and the
factors are a University of Missouri compilation, so federal public domain does not cover them.
The public GitHub repository already redistributes the file with credit. A public Hub dataset is
the same act on a more prominent shelf; its card should carry MCDC's credit and the "no published
terms" note, and the owner may want to ask MCDC.

## 4. Query and push-down design

**What push-down buys.** "Total private construction wages for these five counties, 2014–2026" is
20 CSV files per county through today's QCEW client, 100 in all. Against the curated QCEW Parquet
it is one predicate on `area_fips IN (…)`, `own_code = 5`, `industry_code = '1012'`, returning
$928,100,273 for five Indiana counties in 2024 in 5 ms locally (*measured*). "Every county in
Indiana with average annual pay above $55,000" is one scan (33 counties in 2024). BEA already
pushes down natively (ADR-019), so it needs nothing from this.

**Grammar, not SQL.** OpenContext guards a *remote* portal's SQL with a keyword denylist
(`query_validator.py`: `DROP`, `SET`, `CALL`, …). That works only because Socrata or ArcGIS
sandboxes the query. Against our own DuckDB, a denylist is not a guard: `read_csv('/…')`,
`ATTACH`, `COPY` and `INSTALL` are all `SELECT`-shaped. DuckDB's `enable_external_access = false`
would lock the engine down, but it also blocks the remote reads the mirror needs. So the tool
accepts **structured JSON, compiled to parameterized SQL, never text**:

```jsonc
{
  "indicator": "qcew_total_wages",            // from the registry, not a column name
  "places": { "within": "Indiana", "kind": "county" },   // or a list of names or GEOIDs
  "industry": "1012", "ownership": "private",  // registry dimension vocabularies (ADR-013)
  "years": { "from": 2014, "to": 2026 },
  "filter": [{ "measure": "average_annual_pay", "op": ">", "value": 55000 }],
  "aggregate": { "fn": "sum", "over": "places", "by": "year" },
  "limit": 200
}
```

- **Identifiers validated against the catalog and registry**: places resolve through the core
  resolver (an ambiguous name stops the query as it does today); `within` expands through catalog
  containment; indicators, dimensions and codes come from the registry's vocabularies; measures
  and operators come from a per-dataset allowlist. Nothing the caller writes reaches SQL except as
  a bound parameter.
- **Aggregation rules live with the measure**: `sum` only for additive measures (employment,
  establishments, total wages); an average weekly wage over several counties is recomputed as
  total wages ÷ employment ÷ 52, never averaged. Rates, indexes, OEWS means and chained values
  refuse `sum`.
- **Suppression is never a zero.** A group containing any suppressed member returns `null`, with
  the count and names of the suppressed members and a limitation. A partial total is not offered,
  unless the owner rules for a labelled lower bound (decision 6).
- **Budgets**: a cap on places (e.g. 200 counties), years and output rows. Row groups to be read are
  estimated from Parquet statistics before running, and an over-budget query is refused with the
  narrower query to ask. Rendering stays within ADR-017's 24,000-character budget, and execution
  under the 29 s Lambda limit.
- **Provenance**: the envelope's `source` gains a `mirror` block: repository, revision (commit),
  path, upstream file URL, upstream `Last-Modified`/`ETag`, and snapshot time. `retrievedAt` is the
  snapshot time, `vintage` the BLS release, and `limitations` says "from a mirror of BLS files as
  published <date>". Footnote codes travel per row, as they do from the API.

**Verb.** Push-down is a way of answering `compare_places`, not a new kind of question.
*Recommended*: extend `compare_places` with a `places.within` selector, `filter` and `aggregate`
options, and keep the six-verb family. `get_indicator` gains nothing but mirrored years, and
`get_raw` stays the id-level escape hatch, served from the mirror when it has the ids. A seventh
family verb (`query`) is the alternative if push-down grows beyond "one indicator across places".
It would change the contract suite for every server, so it is not worth doing for one dataset.

**Where the mirror sits.** It sits at the **`IndicatorFetch` seam** (ADR-011 §2), not inside
`createHttpClient`. The HTTP client caches URL → body; a mirror answers (series, years) →
observations, and must know which months it lacks. A `mirrorFirst(fetch)` wrapper reads the mirror
and calls the live API only for series the mirror lacks, or for periods newer than its snapshot,
batched as today. cyanheads' observation mirror (the benchmark's prior art) has the same shape.

## 5. Freshness and correctness

- **The newest month comes from the live API.** The mirror's manifest records each program's
  snapshot `Last-Modified`. A request whose range reaches past it, or any request on a program's
  release day before the refresh has run, calls the API for the tail. An answer mixing sources says
  which periods came from where.
- **Revisions.** The refresh reprocesses a program whenever its ETag changes, whole partition by
  whole partition. LAUS's April five-year revision and the CES benchmark then land within one
  refresh. Between a BLS release and the refresh, a mirrored value can be superseded. The envelope's
  snapshot date makes that visible and the live tail limits it to history.
- **Preliminary flags and footnotes** stay columns (`footnote_codes`) with the program's footnote
  table beside them. A `P` row in the mirror is labelled preliminary exactly as the API labels it.
- **Labelling.** Every mirrored number carries `source.mirror` and a limitation naming the snapshot.
  A mixed answer lists both. `cache` stays the in-memory HTTP cache's report and is not reused
  for the mirror.

## 6. How this meets M17 (#297)

The mirror and M17 act on the same scarce thing, the one BLS key's 500 a day shared by every
caller, from two sides. M17 limits how much a caller may ask; a mirror lowers what each answer costs
upstream. This spike leaves the design of M17's limits to #297, but notes where the two meet:

- M17's monitoring is the evidence this spike's trigger needs: upstream calls, cache hits and budget
  remaining per source per day. If M17 emits them, stage 2 has its go/no-go number.
- A persistent budget counter, if M17 builds one, is also the signal for "fall back to the mirror"
  and for answering "quota spent for today" honestly (today's in-memory counter under-counts across
  containers and over-counts QCEW).
- Mirror-served answers spend no BLS quota, but they do cost Lambda time and Hugging Face resolver
  requests. Push-down queries are heavier per call. Per-client limits should count tool calls, not
  upstream calls, so that they stay meaningful whichever tier answers.

## 7. The smallest thing that unblocks: a staged path

- **Stage 0: instrument and trim (small, no mirror).** One structured log line or CloudWatch EMF
  metric per upstream call (source, host, cache hit, budget remaining), possibly folded into M17's
  monitoring. Stop QCEW CSVs counting against the BLS API budget (their own source key and
  counter). Cache timeseries responses (e.g. a 12-hour fresh TTL, stale-if-error). Map BLS's
  daily-threshold refusal to `QuotaExceededError`. These answer "does quota bind" and remove the
  measured waste.
- **Stage 1: OEWS history, bundled (small; unblocks the owner's trial finding).** A
  `geography-build`-style script downloads the per-year state, MSA and national zips (May 2019–2024
  to start; earlier years are the same parser with the 2010-era header), maps columns by name per
  year, turns markers into null plus footnote, keeps all occupations and the 22 major groups, and
  writes a versioned table (≈1 MB) with a SHA-256 manifest. The table ships in `server-bls` next to
  the catalog and is read with better-sqlite3, with no DuckDB and no network. OEWS behind
  `get_indicator` answers a year range from the table for past years and from the API for the
  latest, with the comparability caveat and the metro code-break caveat.
- **Stage 2: the Hugging Face mirror and push-down (only when stage 0's numbers or a real question
  demand it).** The HF dataset follows the Haddad pattern: an ETag manifest, a scheduled Actions
  refresh, a raw layer plus a compacted `serve/` layer, a generated card, offline tests, and a
  publisher separate from the pipeline with the write token only in CI secrets. Its first contents
  are curated QCEW (annual 2001→, quarterly 2014→) and the stage-1 OEWS tables. It needs DuckDB in
  `server-bls` via an S3-staged upload or a layer, `mirrorFirst` at the fetch seam, and the
  `compare_places` push-down options. Trigger: the BLS budget regularly above an agreed share, or
  users asking multi-county, multi-year QCEW questions.
- **Stage 3: LABSTAT timeseries in the mirror** (LAUS, SM, CES, CPI, JOLTS, PPI; ≈105 MB) behind
  the same seam, with the live-API tail, and the Geocorr migration.

### Migration: Geocorr to the dataset

Today the national place→county file is vendored at
`geography-build/src/data/geocorr/geocorr2022_place_county_natl.csv.gz` (532,535 bytes, 36,179
rows), read by `parseGeocorr` at catalog build. Migration, when stage 2 exists: publish the same
file unchanged as a `geocorr/` config, with its SHA-256 and the README's provenance in the card.
Switch `download.ts` to fetch it from a pinned revision URL, verify the checksum, and fall back to
the vendored copy for one release. Then delete the vendored copy in a later PR, moving its README
to `docs/archive/` per the docs rule. The parser, the transform and the Sedona regression test
carry over unchanged (as the Geocorr spike anticipated). Nothing at runtime changes: the catalog
still bundles the edges. Doing it before stage 2 would add a network dependency to the catalog build
for a file that has not changed since 2026-09-17, so it waits.

## Decisions for the owner

1. **Stage 0 now?** *Recommended:* yes, as one small issue: per-upstream-call metrics, QCEW off the
   BLS API budget, a timeseries response cache, and BLS's threshold refusal mapped to
   `QuotaExceededError`. Alternatives: fold the metrics into M17 (#297) and file only the three
   fixes here; or do nothing until M17.
2. **OEWS history as the first stage?** *Recommended:* yes: May 2019–2024, state, MSA and nation,
   all occupations plus the 22 major groups, bundled in `server-bls` and read with better-sqlite3.
   Alternatives: back to 2012, or to 1997, for longer history (same parser, more header variants);
   detailed occupations too (≈17 MB, over today's zipped headroom); or publish to Hugging Face from
   day one.
3. **Metro OEWS across code changes.** *Recommended:* serve a metro's history only for years whose
   code matches the current code, and state where the series breaks. Alternative: build a
   code-vintage crosswalk for the 36 changed codes (more work, more to verify).
4. **Stage-2 host.** *Recommended:* a Hugging Face dataset as the owner directed, read with a
   free-account read token held like the agency keys (ADR-006), so the limits are the account's
   rather than a shared AWS egress IP's. Alternatives: anonymous `hf://` reads; S3 + DuckDB
   (in-region, but an administrator bucket, IAM and CI write credentials that ADR-007 rules out);
   bundled snapshots only.
5. **Stage-2 trigger.** *Recommended:* build when M17 (or stage-0) metrics show the BLS budget above
   50% on several days in a month, or when multi-place QCEW history questions recur in trials.
   Alternative: build on a schedule after v1.0.
6. **Suppressed cells in aggregates.** *Recommended:* a group with any suppressed member returns
   null plus the suppressed members. Alternative: return the partial sum labelled "lower bound,
   excludes N suppressed".
7. **Push-down surface.** *Recommended:* options on `compare_places` (`places.within`, `filter`,
   `aggregate`), with structured JSON only. Alternative: a seventh family verb `query`, which changes
   the contract for every server.
8. **Geocorr to the dataset.** *Recommended:* migrate at stage 2, not before, and ask MCDC about
   terms before the public upload. Alternative: keep it vendored indefinitely (it is 0.5 MB and
   stable).
9. **Mirror scope at stage 3.** *Recommended:* the eight programs the server serves (≈105 MB),
   plus curated QCEW. Alternative: all LABSTAT programs and full-detail QCEW (5–15 GB, for
   community reuse rather than the servers).

## Proposed build cut (after the rulings; file nothing before)

1. **Upstream-call metrics and budget hygiene** (stage 0, decision 1): metrics, QCEW's own source
   key, a timeseries cache TTL, `QuotaExceededError` for BLS's refusal; tests with a fake BLS
   threshold body.
2. **OEWS history build** (stage 1, decisions 2–3): a per-year parser (name-mapped headers, markers
   to null and footnote), a checksum manifest, fixtures from recorded 2019 and 2025 tables, and a
   bundled artifact.
3. **OEWS history in `bls_get_indicator` and `bls_compare_places`**: past years from the table, the
   latest from the API, comparability and code-break caveats, `describe_source` and docs, and an
   eval case ("Colorado mean wage, change since 2019").
4. *(Stage 2, only on the trigger, decisions 4–7)*: an ADR; the Hugging Face publisher pipeline;
   DuckDB in `server-bls` with the zip-size change; `mirrorFirst`; `compare_places` push-down with
   the grammar and budgets.
5. *(Stage 3, decisions 8–9)*: the LABSTAT programs in the mirror; the Geocorr migration.

## Not measured

- Production usage: no upstream-call counts exist (§1). CloudWatch was not read.
- DuckDB `hf://` latency, memory and cold start **inside Lambda**; the figures above come from a
  laptop against a third party's public dataset. Whether Lambda egress IPs share anonymous HF
  limits with other tenants.
- Parquet sizes for CES national, PPI and CPS, which are scaled from measured bytes per row, and
  for QCEW beyond 2024 annual.
- The 58 LABSTAT programs the servers do not use.
- Pinning a revision in an `hf://` path from DuckDB (documented, not exercised).
- The SOC 2018 transition's exact treatment in May 2019–2021 tables, and OEWS headers for years
  other than 2010, 2019 and 2025.

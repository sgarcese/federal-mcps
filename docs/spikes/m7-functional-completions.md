# Spike: M7 — functional completions (pickers, metro/region completions, PPI)

M1–M6 delivered six BLS programs (LAUS, CES, OEWS, CPI, JOLTS, QCEW) behind the family verbs,
each at its **headline** series and at the geographies that were mechanical to derive, and cut
the first release. Every ADR since M4 deferred a list of depth and coverage items "to a later
milestone". This spike inventories those items against what the code and catalog hold today,
verified 2026-09-17, and proposes M7 as the milestone that makes the BLS server **feature-complete
for its stated scope** before the family grows to Census and CDC PLACES.

Owner rulings that frame it (2026-09-17, on #135/#51): no directory submission; the hosted data
mirror (#51) is deferred until usage shows quota or freshness actually binding — bundled reference
data plus the live BLS API is the right combination for now; milestone 7 is functional
completions, not infrastructure.

## Inventory of deferred items, verified against code and catalog

| # | Item | Deferred by | What exists today | What is missing | Verified fact |
|---|---|---|---|---|---|
| A1 | **CPI expenditure-item picker** ("inflation by type of good, by metro") | ADR-010 §2, M6 spike | `buildCuSeriesId` hard-codes item `SA0` (all items); 22 metro CPI codes in the catalog | An `item` argument and a curated item vocabulary | Series shape `CU·S/U·R/S·area(4)·item(3)`; Denver publishes food, housing, energy, gasoline, medical (M6 spike) |
| A2 | **QCEW NAICS industry + ownership picker** (construction labor cost by county) | ADR-011 §4 | `parseQcewHeadline` picks `own_code 0` / `industry_code 10`; the whole area slice is already fetched and cached | `industry` and `ownership` arguments; NAICS supersector vocabulary | The slice carries every ownership × industry row; no extra fetch |
| A3 | **OEWS occupation picker** | ADR-010 §2 | `buildOeSeriesId` hard-codes occupation `000000` (all) and industry `000000` | An `occupation` argument; SOC vocabulary | Series shape `OE·U·areatype·area(7)·industry(6)·occupation(6)·datatype(2)` |
| B1 | **OEWS metros** | ADR-010 (statewide only) | The catalog **already carries 393 OEWS metro codes** (sumlevel 310, from `oe.area`, which has a `state_code` column) | `oewsStateCode` reads only states; `oe-indicators.ts` needs to accept a 310 candidate's code | `oe.area`: `08 0019740 M Denver-Aurora-Centennial, CO` |
| B2 | **CES multi-state metros** | #110 (single-state only) | 384 single-state SM metro codes; `parseCesArea` skips any title naming two or more states | A state prefix for multi-state metros | `sm.area` has **no state column**; BLS publishes one series per multi-state metro under one state (e.g. NYC `SMU36…`, Kansas City `SMU29…`) — hypothesis: the first state in the title; verify against published ids at build |
| B3 | **QCEW metro (MSA)** | ADR-011 §3 | County + state area codes derived from GEOID | The QCEW `C`-code as a catalog column | `C1974` ↔ CBSA `19740`: looks like `C` + CBSA/10 for metropolitan areas; verify for micropolitan and CSA rows before relying on it, else store the code from QCEW's own area table |
| B4 | **CPI census region / division fallback** | ADR-010 §4 ("a refinement") | `cpiFallback` goes straight to the U.S. city average | Region/division entities in the catalog and a state→division edge; CPI area codes `0100`–`0400` (regions) and `0110`–`0490` (divisions) | `cu.area` lists them; the catalog has **no** sumlevel 020/030 entities |
| C1 | **PPI (Producer Price Index), national** | ADR-012 roadmap | Nothing | A seventh program; the first with **no geography** | PPI is national-only (commodity `WPU…`, industry `PCU…` series); "inputs to construction" `WPUIP2311001` verified in the M6 spike |

Not on the list, and staying out: location-quotient / over-the-year-change QCEW columns, QCEW
annual-average mode, OEWS industry × occupation cross-tabs, CPI size-class areas, and the LABSTAT
mirror (#51).

## What M7 builds

Three tracks on the existing registry, one seam first:

- **Track A — one dimension seam, three pickers.** An `IndicatorDefinition` can declare
  *dimensions* (name, curated vocabulary, default). `bls_get_indicator` and `bls_compare_places`
  accept them as named optional arguments; `bls_list_indicators` publishes each indicator's
  vocabulary so the model never guesses a code. CPI items, QCEW industry/ownership and OEWS
  occupations are the three instances.
- **Track B — geography completions.** OEWS metros (a code lookup), CES multi-state metros and
  the QCEW metro code (two catalog-build columns), and the CPI region/division ladder (two new
  summary levels in the catalog, plus the fallback order metro → division → region → U.S.).
- **Track C — PPI.** A seventh registry program on the timeseries API, national scope declared
  on the definition, so a place-less question has a truthful answer and a place-ful one gets an
  explicit "PPI is national only" caveat rather than a refusal or a fabricated local number.

## The decisions (numbered; recommendations given)

### 1. How a dimension reaches the tool contract

Options: **(a)** named optional arguments per dimension kind — `item`, `industry`, `ownership`,
`occupation` — each validated against the indicator's declared vocabulary; **(b)** one generic
`detail: { dimension, code }` argument; **(c)** explode each picked value into its own indicator
name (`cpi_food`, `cpi_energy`, …).

**Recommendation: (a).** Named arguments are what a model reads best and what `compare_places`
can carry unchanged; (b) hides the vocabulary behind a second lookup; (c) multiplies the indicator
list by the vocabulary size and breaks `list_indicators` as a short catalog. The seam: an optional
`dimensions` array on `IndicatorDefinition` (`{ argument, vocabulary: {code,label}[], default }`),
`buildSeriesId`/the QCEW row-picker receive the chosen codes, and the tool's Zod schema gains the
four optional string arguments with per-indicator validation in the handler (an argument an
indicator does not declare is rejected with the list it does accept). No behaviour change for
existing calls — every dimension defaults to today's headline.

### 2. Vocabularies: curated, short, and published by `list_indicators`

Full SOC (~800) and NAICS (~1,000) lists are not a vocabulary a model should scan per turn.
**Recommendation:** curated lists per dimension — CPI ~10 expenditure groups (all items, food,
food at home, housing, shelter, energy, gasoline, medical care, transportation, apparel), QCEW
the ~20 NAICS supersectors/sectors (2-digit, including `23` construction) and four ownership
codes (total, private, federal, state, local government), OEWS the 22 SOC major groups (2-digit).
`bls_list_indicators` returns each indicator's vocabulary. Exact codes are an escape hatch, not a
vocabulary: a caller who knows a 6-digit SOC or NAICS uses `bls_get_raw` with the built id. Every
vocabulary entry is verified against a published series at build (unit test per builder, as
today).

### 3. OEWS metros: read the code the catalog already has

**Recommendation: build it in M7, Track B, smallest item.** `oewsCodeOf` returns the state
derivation for states and the catalog's OEWS code for a sumlevel-310 candidate; `describe_source`
drops "(metro/CBSA planned)". No catalog change.

### 4. CES multi-state metros: verify the state-assignment rule, then store it at build

**Recommendation:** at build, test the hypothesis that BLS files a multi-state metro under the
first state in its `sm.area` title, against published ids for New York, Kansas City, Philadelphia
and Washington. If it holds, `parseCesArea` emits those rows with that state and the indicator
adds the caveat "CES publishes this multi-state metro as one series under <state>". If it does
not hold for every case, keep a small verified exception table in `geography-build/data/static.ts`
(a build-time table, not a server-side one — the "no hand-typed FIPS tables in servers" rule).

### 5. QCEW metro: a catalog column, per ADR-011 §3

**Recommendation:** verify the `C` + CBSA/10 pattern across metropolitan and micropolitan rows
of QCEW's own area-title file; store the code as a `QCEW` agency-code row on the CBSA entity at
build either way (derived if the pattern holds, else parsed from that file). `qcewAreaCodeOf`
then reads it; `agglvl_code 40` selects the MSA total row.

### 6. CPI regions and divisions: add them to the geography, not to the server

**Recommendation:** add Census **regions (sumlevel 020) and divisions (030)** as catalog entities
with `nests` containment from states, from the Census region/division code table — geography
belongs in core, and Census and CDC servers will want the same levels. Then CPI's fallback ladder
becomes metro → division → region → U.S. city average, each step flagged; and `resolve_place`
can answer "Northeast" or "Mountain division". Caveat to carry: many division/region CPI series
publish bimonthly.

### 7. PPI: a national-scope program on the timeseries API

**Recommendation:** register PPI as the seventh program with `scope: "national"` on its
definitions. `bls_get_indicator` treats `place` as optional for a national-scope indicator (default
"United States"); given a place, it answers the national series with the limitation "PPI is
published nationally only; this is not a <place> figure". Headline vocabulary via decision 1's
dimension seam: a curated list of commodity and industry indexes (final demand, all commodities,
inputs to construction, and a handful of construction materials — each id verified at build). The
architecture doc's "construction material prices by geography are not a BLS query" line becomes
what the server itself says.

### 8. `compare_places` carries the same dimensions

**Recommendation: yes** — the same named arguments apply to every place in the comparison, so
"construction wages in Denver vs Boulder vs Jefferson County" is one call.

### 9. Scope and version

M7 ships Tracks A, B and C above and bumps to **v0.2.0** (ADR-012 §4: minor per milestone). Out:
the items listed under "staying out", the mirror (#51), and any new agency server.

## Proposed build-issue cut (from the rulings, not before)

1. **M7.1 Dimension seam** — `IndicatorDefinition.dimensions`, the four optional tool arguments
   with per-indicator validation, `list_indicators` vocabulary output, `compare_places` pass-through.
   No behaviour change; the seam every picker consumes.
2. **M7.2 CPI items** — vocabulary + builder + fixtures; the owner's "inflation by type of good".
3. **M7.3 QCEW industry and ownership** — row-picker over the cached slice; NAICS 23 by county.
4. **M7.4 OEWS occupations and metros** — occupation dimension; metro code lookup (decision 3).
5. **M7.5 Metro codes in the catalog** — CES multi-state state rule (decision 4) and the QCEW
   `C`-code column (decision 5); `describe_source` granularity updated.
6. **M7.6 Regions and divisions** — catalog entities + containment; CPI fallback ladder.
7. **M7.7 PPI program** — national-scope handling + curated vocabulary.
8. **M7.8 Reconcile and release** — docs, evals for each new capability (a picker case, a
   multi-state metro, a division fallback, a PPI place-ful question), `describe_source`, v0.2.0.

Build order: 7.1 first (seam), then 7.2–7.4 in parallel (independent programs, one owned file
each), 7.5–7.6 together (both are geography-build), 7.7, then 7.8.

## Out of scope for M7

The hosted data mirror (#51, deferred pending usage), Census and CDC PLACES servers, the composite
endpoint, QCEW location quotients and annual averages, OEWS industry × occupation, CPI size-class
areas, and any change to the family verbs.

# Spike: M3 — Labor market core (LAUS, the first real number)

Every server so far returns structure and provenance but **no actual statistics**. M3 turns
the resolver's output into a real number: the unemployment rate (and labor force, employment,
unemployment level) for a place, from BLS **Local Area Unemployment Statistics (LAUS)**. It is
the flagship data tool; the patterns it sets — series-ID builders, the fetch path, the number
envelope, the caveat behaviour — every later program (CES, OEWS, CPI, QCEW, JOLTS) reuses.

The resolver (M2) already does the hard geographic part: a place resolves to its GEOID, its
summary level, its **LAUS area code** (an `agency_code` column), its parents, and structured
flags (`below_threshold`, etc.). M3 consumes that.

## What M3 builds
- A **series-ID builder**: pure `(area, measure, seasonal) → LAUS series id`, unit-tested
  against known-good published ids (CLAUDE.md: "series and variable IDs are built, not typed").
- A **fetch path** to real LAUS observations, through the core HTTP client (retry/backoff,
  timeout, budget counter, two-tier cache — all built in M1 #5), replayed from recorded
  `fixtures/` in unit tests (agency APIs are never called in unit tests).
- The **family-verb tools** that return the shared provenance envelope with the value(s),
  footnotes (preliminary/revised), vintage, the resolved place, and a citation.
- `bls_describe_source` flips LAUS from `planned` to `available`.

## The decisions (numbered; recommendations given)

### 1. Tool surface: family verbs, not program-specific names
`docs/architecture.md` ("Server one: BLS") sketches program-named tools like
`bls_get_unemployment`. CLAUDE.md and the contract harness require the **family verb set**
(`resolve_place`, `list_indicators`, `get_indicator`, `compare_places`, `get_raw`,
`describe_source`). These conflict.

**Recommendation:** family verbs. M3 ships `bls_get_indicator` (with a `measure` argument),
`bls_list_indicators`, and `bls_get_raw`; `bls_resolve_place`/`bls_describe_source` already
exist. Update the architecture doc's tool table to match (docs describe what is). A
program-named convenience alias, if ever wanted, is additive later.

### 2. Data source: BLS timeseries API now, LABSTAT mirror deferred (ties to #51)
Two ways to get LAUS observations:
- **BLS Public Data API v2** (`api.bls.gov/publicAPI/v2/timeseries/data`): JSON, keyed
  (BLS_API_KEY already wired, ADR-006), **50 series/query, 500 queries/day**. Simple, but the
  daily cap is a shared, exhaustible resource.
- **LABSTAT flat files** (`download.bls.gov/pub/time.series/la/…`): no key, no daily cap, always
  current, but large files to fetch, parse and host — this is spike **#51's** hosted-mirror
  question, and `docs/architecture.md` already leans this way ("LABSTAT observation mirror for
  LAUS and SM").

**Recommendation:** M3 uses the **timeseries API** for the MVP — it is keyed, already wired,
and returns exactly the requested series with footnotes — behind the core client's cache and
50-series batching, which keeps the cap comfortable for interactive use. The **LABSTAT mirror
is #51's job**, a fast-follow if the cap bites at scale, not an M3 blocker. (If the owner
would rather build the mirror first, M3 depends on #51 and grows.)

### 3. Measure vocabulary, mapped to series-id components
LAUS publishes four measures per area: unemployment rate (code 03), unemployment level (04),
employment (05), labor force (06). **Recommendation:** a small typed `measure` enum
(`unemployment_rate` | `unemployment` | `employment` | `labor_force`) mapped in the builder,
so the model asks in words and the id is built, never typed.

### 4. Seasonal adjustment: default not-adjusted below state
LAUS publishes seasonally adjusted (S) series only for states and a few large areas; counties,
cities and most metros are **not seasonally adjusted (U)**. **Recommendation:** default `U` at
sub-state levels, expose a `seasonallyAdjusted` flag, and when SA is requested where it is not
published, return the `U` series with an explicit flag rather than an error.

### 5. Period semantics: latest by default, range on request
**Recommendation:** default to the latest ~13 months (a year of context plus the newest);
accept explicit `startYear`/`endYear`. The tool returns the observation series, each point
carrying its period and footnote codes; the newest point is the headline.

### 6. Below-threshold behaviour: the county, explicitly flagged
When a place is a city under the LAUS 25,000 threshold (the resolver flags `below_threshold`),
`get_indicator` must **not** silently return nothing or a fabricated city number.
**Recommendation:** return the surrounding **county's** value with an explicit caveat in the
envelope ("covers <county>, not just <place>; <place> is below the LAUS 25,000 city threshold")
and the county's place block — never a silent substitution. This caveat behaviour is the
product's core value, per the UGEO-Bench findings.

### 7. Numbers carry their caveats (envelope)
`get_indicator` returns the shared envelope: the value(s) with each period's **footnote codes
mapped to plain language** (P = preliminary, R = revised), the vintage, the resolved place, the
LAUS series id, and a ready-to-paste citation. `get_raw` returns the unprocessed BLS response
for trust/debugging.

### 8. Scope: LAUS only in M3
**Recommendation:** M3 ships **LAUS only** — the flagship. CES State & Area (SM), OEWS, CPI and
JOLTS are M4/M5, reusing M3's builder/fetch/envelope patterns. QCEW is separate (its own CSV
client, not the timeseries API) and stays in M5.

## Proposed build-issue cut (from the rulings, not before)
1. LAUS **series-id builder** + measure vocabulary (pure, unit-tested against known-good ids).
2. LAUS **fetch through the core HTTP client** + recorded fixtures + a `LIVE_TESTS=1` smoke.
3. `bls_get_indicator` (place + measure + period → envelope), incl. the below-threshold
   county fallback and footnote mapping.
4. `bls_list_indicators` (what LAUS offers for a resolved place) and `bls_get_raw`.
5. Flip LAUS to `available` in `bls_describe_source`; reconcile the architecture doc's tool
   table to the family verbs; live-verify against the deployed server.

## Out of scope for M3
CES/OEWS/CPI/JOLTS tools (M4), QCEW's CSV client (M5), the LABSTAT hosted mirror (#51),
`compare_places` (a thin multi-place wrapper, once `get_indicator` is solid), and any
non-LAUS measure.

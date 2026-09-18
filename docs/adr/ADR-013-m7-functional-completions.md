# ADR-013: M7 functional completions — dimension pickers, geography completions, and PPI

**Status:** accepted (2026-09-17) ·
**Spike:** [`m7-functional-completions`](../spikes/m7-functional-completions.md) ·
**Affects:** `packages/server-bls`, `packages/geography-build`, `packages/core` (geography
summary levels), `docs/architecture.md`

## Context

M1–M6 delivered six BLS programs behind the family verbs, each at its headline series and at the
geographies that were mechanical to derive, and cut v0.1.0. ADR-010 §2 and ADR-011 §3–4 deferred
the sub-dimension pickers and several geographies "to a later milestone"; ADR-012 named a
national PPI program as the next new program. The owner ruled on 2026-09-17 that milestone 7 is
these **functional completions** — not the hosted data mirror (#51), which is deferred until usage
shows quota or freshness actually binding; bundled reference data plus the live BLS API is the
right combination for now. This ADR records the M7 rulings (owner, 2026-09-17, on the M7 epic);
build issues are cut from it.

## Decisions

1. **Dimensions are named optional tool arguments, declared on the registry.** An
   `IndicatorDefinition` may declare `dimensions` (`{ argument, vocabulary: {code,label}[],
   default }`). `bls_get_indicator` and `bls_compare_places` accept `item`, `industry`,
   `ownership` and `occupation` as optional strings; the handler validates each against the
   indicator's declared vocabulary and rejects an argument the indicator does not declare, naming
   what it does accept. The chosen codes flow to the series-id builder or (QCEW) the row picker.
   Every dimension defaults to today's headline, so existing calls are unchanged. Rejected: a
   generic `detail` argument (hides the vocabulary) and exploding picked values into indicator
   names (multiplies `list_indicators`).

2. **Vocabularies are curated, short, and published.** CPI ≈ 10 expenditure groups; QCEW the
   ~20 NAICS supersectors/sectors plus four ownership codes; OEWS the 22 SOC major groups; PPI a
   curated list of commodity and industry indexes. `bls_list_indicators` returns each indicator's
   vocabulary. Exact 6-digit SOC/NAICS or arbitrary series are reached through `bls_get_raw`, not
   through a vocabulary. Every vocabulary entry is verified against a published series id by a
   unit test at build.

3. **OEWS metros read the codes the catalog already holds.** The catalog carries OEWS metro
   codes (sumlevel 310, from `oe.area`, which names the state); `oewsCodeOf` returns them for a
   metro candidate. No catalog change.

4. **CES multi-state metros: verify the state rule at build, store the state in the catalog.**
   `sm.area` carries no state; BLS publishes one series per multi-state metro under one state. The
   build tests the hypothesis "the first state in the area title" against published ids (New York,
   Kansas City, Philadelphia, Washington) and, if it holds, emits those metros with that state; if
   it fails for any case, a small verified exception table lives in `geography-build/data/static.ts`
   (build-time, never server-side). The indicator carries the caveat that the metro is published
   as one series under that state.

5. **QCEW metro is a catalog agency-code column.** Per ADR-011 §3, the QCEW `C`-code is stored on
   the CBSA entity at build — derived from the CBSA code if the `C` + CBSA/10 pattern verifies
   across metropolitan and micropolitan rows of QCEW's area-title file, else parsed from that
   file. `qcewAreaCodeOf` reads it; `agglvl_code 40` selects the MSA total row.

6. **Census regions and divisions join the geography catalog.** Regions (sumlevel 020) and
   divisions (030) become entities with `nests` containment from states, built from the Census
   region/division code table, so `resolve_place` answers "Northeast" or "Mountain division" and
   later agency servers reuse the levels. CPI's fallback ladder becomes metro → division → region →
   U.S. city average, each step flagged, with the caveat that many region/division series publish
   bimonthly. Rejected: a server-side state→division map (CLAUDE.md: geography lives in core).

7. **PPI is the seventh program, with national scope on the definition.** PPI registers on the
   timeseries API with `scope: "national"`. For a national-scope indicator `place` is optional
   (default "United States"); when a place is given the national series is returned with the
   limitation "PPI is published nationally only; this is not a <place> figure" — never a refusal
   and never a fabricated local number. The headline vocabulary (final demand, all commodities,
   inputs to construction, selected construction materials) follows decision 1.

8. **`bls_compare_places` carries the same dimensions**, applied to every place in the comparison.

9. **Scope and version.** M7 = tracks A (pickers), B (geography completions), C (PPI) and ships
   as **v0.2.0** (ADR-012 §4). Out: QCEW location quotients and annual averages, OEWS industry ×
   occupation cross-tabs, CPI size-class areas, the mirror (#51), the composite endpoint, and any
   new agency server.

## Consequences

- The **dimension seam** (decision 1) is built first, as a no-behaviour-change refactor, and every
  picker (M7.2–M7.4, M7.7) registers on it; the tool contract grows four optional arguments once.
- The geography catalog gains two summary levels and two agency-code columns; `geography-build`
  work (M7.5, M7.6) is independent of the pickers and can run in parallel.
- After M7 the BLS server is feature-complete for the family's stated scope; the roadmap continues
  with the Census server, then CDC PLACES (ADR-001).

## Scope

M7.1 dimension seam · M7.2 CPI items · M7.3 QCEW industry + ownership · M7.4 OEWS occupations +
metros · M7.5 metro codes in the catalog · M7.6 regions/divisions + CPI ladder · M7.7 PPI ·
M7.8 reconcile, evals, v0.2.0.

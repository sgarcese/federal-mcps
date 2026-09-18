# Changelog

All notable changes to federal-mcps. Versions follow ADR-012 §4: `0.x`, a minor bump per feature
milestone, patches for fixes; `1.0.0` is reserved for the API-stability commitment.

## 0.2.0 — M7 functional completions (2026-09-18)

Added
- **Pickers** (ADR-013): optional `item`, `industry`, `ownership` and `occupation` arguments on
  `bls_get_indicator` and `bls_compare_places`, validated per indicator against curated
  vocabularies that `bls_list_indicators` publishes. CPI expenditure groups (10), QCEW NAICS sectors
  (21) and ownership (5), OEWS SOC major groups (22), PPI commodity indexes (17).
- **PPI**, the seventh program, national only: `producer_price_index` answers with no place and
  flags any place given as not a local figure.
- **Geography completions:** OEWS metros; CES multi-state metros (filed under their first state,
  with a caveat); QCEW metros via the catalog's C-codes; Census regions and divisions as catalog
  entities, with CPI falling back metro → division → region → U.S. city average, each step flagged.
- Agency-code notes travel from the catalog to the envelope (`caveatOf` on the registry).

Fixed
- `bls_get_raw` accepted only LAUS ids despite its description; it now accepts any timeseries id
  the server builds.
- QCEW sector detail with the default total ownership is rejected with guidance instead of
  returning an empty answer (QCEW publishes sectors by ownership only).

## 0.1.0 — M6 release hardening (2026-09-17)

The first release: six BLS programs (LAUS, CES, OEWS, CPI, JOLTS, QCEW) behind the family verbs
over the shared geography catalog; a Boston-grounded eval set against the live server; a
connector quickstart; the connector review criteria as a quality bar (tool titles, accurate
descriptions, privacy policy); a fresh checkout runs `npm test` with no build; the national
place → county crosswalk that makes the below-threshold LAUS fallback work everywhere.

Known limitations at 0.1.0 (addressed in 0.2.0): OEWS and QCEW metros, CES multi-state metros,
region/division CPI, and every sub-dimension picker.

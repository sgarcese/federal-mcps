# Evals

A small, reported gate that answers "does the server actually answer well?" — not just "does it
respond?" (ADR-012 §1). The question set is drawn from the kinds of analysis the **Boston Planning
Department Research Division** does — labor market, wages, prices, and peer-city comparison
([bostonplans.org/research](http://www.bostonplans.org/research)) — plus the judgment cases that are
this project's core value.

## Run it

```bash
node docs/evals/run.mjs            # against the live server, https://bls-mcp.responsive.city/mcp
BLS_URL=http://localhost:3000/mcp node docs/evals/run.mjs   # against a local server
npm run eval                       # same, from the repo root
```

It calls each question's tool against the live server and grades the provenance envelope against a
rubric, printing per-question PASS/FAIL and an overall pass-rate. It exits non-zero if the rate is
below the bar (`BAR`, default 0.9). This is a **reported gate, not a CI merge gate** — it hits the
live public API, so it is run before a release (M6.4), not on every PR.

## What it covers

- **One lookup per program** for the Boston region: metro/county unemployment (LAUS), Massachusetts
  payroll employment (CES), Massachusetts occupational wage (OEWS), Boston-metro CPI, Massachusetts
  job openings (JOLTS), Suffolk County covered employment and average weekly wage (QCEW).
- **Peer comparison** (`compare_places`): Massachusetts vs New York vs California.
- **Coverage**: `list_indicators` for a county, `describe_source`.
- **The judgment cases** — the product's core value:
  - ambiguous bare name ("Denver") → the server stops and asks, no value invented;
  - no local CPI (Worcester County) → the U.S. city average, explicitly flagged;
  - a New England town under 25k (Amesbury, MA) → served via the town exception;
  - a below-threshold city (Sedona, AZ) → its county's value (Yavapai County) with the
    fallback caveat, never a bare city number (#141);
  - a multi-state metro (Boston) → never a fabricated city-level number;
  - an unknown place → `not_found`, no value.
- **M7 completions (v0.2.0):** a CPI expenditure item by metro, QCEW construction wages by county
  (industry + ownership pickers), an OEWS occupation group by metro, a multi-state metro's CES
  series (flagged), a state with no metro CPI reading its census division (flagged), and a PPI
  question with a place → the national series with the national-only caveat, never a local number.

## Grading

Grading is **deterministic on the server's structured response** (does it carry the right value,
citation, caveat, or status). That makes the eval reproducible and CI-friendly to read. A richer
form — an agent that must *choose* the right tool for a natural-language question, graded by a model
against a rubric — is a future enhancement; the questions here are written to support it (each has a
natural-language `question` alongside the tool call).

## Adding a question

Append a line to `boston.jsonl`: `{ id, area, question, tool, args, rubric }`. Supported rubric
keys: `expectProgram`, `expectStatus`, `mustHaveValue`, `mustNotHaveValue`, `mustCite`, `mustFlag`
(regex on caveats), `mustNotFlag`, `mustNotFabricateCity`, `compareAllOk`, `comparePeriodAligned`,
`listPublished`/`listUnpublished` (`[[indicator, publishedAtLevel], …]`), `describeAllAvailable`.

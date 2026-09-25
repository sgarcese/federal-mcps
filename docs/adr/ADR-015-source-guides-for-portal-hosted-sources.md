# ADR-015: Source guides (skills) + a generic portal connector for portal-hosted sources

**Status:** accepted (2026-09-20); amended by ADR-018 (2026-09-24) ·
**Spikes:** [`m9-cdc-places`](../spikes/m9-cdc-places.md) (deferred),
[`opencontext-socrata-benchmark`](../spikes/opencontext-socrata-benchmark.md),
[`hud-arcgis-hub-guide`](../spikes/hud-arcgis-hub-guide.md) ·
**Amends:** ADR-001 §2 ("one deployable MCP server per agency") ·
**Affects:** new `skills/` directory, `docs/architecture.md`, the roadmap for CDC PLACES, HUD,
FEMA and BEA

## Context

ADR-001 planned one server per agency. The first two (BLS, Census) earned it: each API has a
grammar the model cannot be trusted to type (series ids, variable and geography strings), a
quota to husband, and a contract the host relies on. CDC PLACES is different: it lives on a
Socrata portal where SoQL *is* the grammar and a release is immutable. The benchmark of
2026-09-20 put a fresh model in front of `geo_resolve_place` plus a generic OpenContext Socrata
connector on `data.cdc.gov`: naive, 5 of 7 (it aggregated a state figure PLACES does not
publish, and missed a suppression footnote because search ranked a wide file that drops
suppressed rows); with a 250-word written guide, 7 of 7 in fewer calls. The failures were
policy, not access. HUD's ArcGIS Hub, already deployed on OpenContext by the owner, verified
the same way.

## Decision

1. **Two surfaces, chosen per source.** A source ships either as a *server* (ADR-001) or as a
   *guide*: a verified source guide packaged as an Agent Skill (`skills/<source>/SKILL.md`),
   used by any host together with `geo-mcp` for place resolution and an OpenContext deployment
   of the source's portal for data access.
2. **Guide is the default for portal-hosted sources** (Socrata, CKAN, ArcGIS Hub,
   OpenDataSoft). A server is built only when at least one holds: the API has an id grammar
   the model should never type; upstream quota or caching needs the core client's discipline;
   or a host depends on the family contract (envelope, contract suite) for that source.
   BLS and Census stay servers. CDC PLACES and HUD Open Data (ArcGIS Hub) are guides; the HUD
   User API is a server (ADR-018: an id grammar, a quota and a citation contract). FEMA and BEA are decided by the
   same test when reached.
3. **What a guide must contain**, in this order: the datasets (ids, level, join key, vintage,
   key fields); the resolve-then-query recipe with `geo_resolve_place`; defaults (which value
   type, which release); caveats the numbers carry (intervals, suppression, data year,
   model-based); never-do rules (no aggregation to unpublished levels, no name-based joins where
   an id exists, no wide/derived files); worked examples with verified numbers; and the
   verification date. Every id, field and number in a guide is verified live when written, and
   corrected in the same PR that finds a drift — a guide is a doc that describes what is.
4. **Every guide ships with a guided-run eval set** (`docs/evals/<source>-guided.jsonl`:
   questions, ground truth, rubric) and is released only when a fresh session with the guide
   loaded passes it. The PLACES set is the seven benchmark questions.
5. **Geography stays in core.** Guides never carry FIPS tables; they say how a resolved
   place's identifiers map to the source's keys (e.g. PLACES `locationid` = GEOID; HUD FMR area
   from the county's CBSA). Gaps found this way are resolver issues (#187), not guide text.
6. **Connector gaps go upstream, not into workarounds.** OpenContext bugs met while verifying
   (Socrata plugin requires an app token for untokened portals; ArcGIS plugin's `get_schema`
   failure and layer-0 assumption) are filed upstream by the owner and noted in the guide
   until fixed; guides route around them only by naming a reachable alternative dataset.
   *(Amended by ADR-018.)* A limitation that blocks **access** (not policy) is a release blocker for
   the guide that depends on it: it is filed upstream and gets a guided-run eval case that fails
   until it is fixed.

## Consequences

- A new source costs a verification spike, a skill and an eval set — days, not a milestone.
  The family's value for such sources is the geography resolver plus the guide's discipline.
- Guides carry no runtime guarantees: a host that ignores the skill gets the naive result.
  Usage will show whether that matters; if it does for a source, the server test in §2 is
  re-run with that evidence.
- ADR-001 §2 now reads "one surface per source"; its verb set and contract suite apply to
  servers only. The composite endpoint (ADR-001 §4) mounts servers; a plugin bundles servers,
  guides and cross-source skills.
- Two OpenContext deployments (CDC, HUD) are outside this repository's Terraform; the fleet
  record does not list them.

## Alternatives rejected

- **Build `server-cdc-places` as spiked (M9).** Five issues for guarantees the guided run
  already met; revisit with usage evidence.
- **Hybrid server (indicator/compare tools only, raw via the connector).** Still a package,
  module, instance and deploy path for a source with no id grammar.
- **Instructions inside the OpenContext deployment only.** Ties the guide to one connector's
  config and hides it from hosts that load skills; a skill can be loaded next to any connector.

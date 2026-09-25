# ADR-018: The HUD User server

**Status:** accepted (2026-09-24) ·
**Spikes:** [`hud-surface-cost-benefit`](../spikes/hud-surface-cost-benefit.md),
[`m11-hud-user-server`](../spikes/m11-hud-user-server.md) · **Epic:** #217 ·
**Amends:** ADR-015 §2 (HUD is two sources) and §6 (access limits block a guide) ·
**Affects:** new `packages/server-hud`, `packages/core` (HTTP client: a per-minute limiter),
`terraform/` (a module and the instance), `scripts/` (deploy, admin role), `docs/`

## Context

HUD publishes place-level housing data through two channels. Its ArcGIS Hub carries inventories
(LIHTC, public housing, vouchers, QCT/DDA, a copy of FMR and CHAS) and is served by an OpenContext
connector plus the `hud-open-data` guide. The **HUD User API** carries the statistics a housing
analysis turns on — Fair Market Rents with history and Small Area FMRs, Income Limits and MTSP
limits, CHAS cost burden, and the Picture of Subsidized Households — fresher than the Hub (FMR FY2027
and CHAS 2018–2022 against FY2026 and 2016–2020), behind a token, at 60 queries a minute, with a
required attribution sentence. The South Bend dashboard needed exactly these and could not reach them.

## Decision (owner rulings, 2026-09-24)

1. **A dedicated server, `server-hud`, for the HUD User API** on the family core, tools prefixed
   `hud_` (`hud_resolve_place` from core, `hud_get_indicator`, `hud_compare_places`,
   `hud_list_indicators`, `hud_get_raw`, `hud_describe_source`). The Hub layers stay on the
   OpenContext connector and guide.
2. **Scope:** Fair Market Rents (fiscal years 2017 on; Small Area FMRs by ZIP where HUD sets them),
   Income Limits and MTSP limits (2017 on), CHAS (a curated set of cost-burden measures, releases
   2012–2016 on), and Picture of Subsidized Households (2012 on). The USPS ZIP crosswalk is geography
   and goes into the catalog build later, not into this server.
3. **Indicators:** `fair_market_rent` (`bedrooms` 0–4, default 2), `income_limit` (`level` 30/50/80,
   `household_size` 1–8; defaults 80% and 4), `area_median_income`, `mtsp_limit`,
   `cost_burden_renters` and `cost_burden_owners` (over 30% and over 50%), and Picture's
   `subsidized_units`, `subsidized_people`, `average_household_income`, `share_below_30_ami` and
   `months_waiting` (`program` dimension, default all programs). FMR and Income Limit years are HUD
   fiscal years and are named as such.
4. **Identifiers from the catalog, never typed:** county → `SSCCC99999` (FMR/IL), `stateId`+`entityId`
   (CHAS), `statecode`+FIPS (Picture); place → Picture and CHAS ids from its GEOID; New England towns
   → county-subdivision ids, the way LAUS already does. **No FMR-area catalog column:** the API maps a
   county to its FMR area, and the answer names it.
5. **Rate limiting:** a per-minute token bucket in the core HTTP client, configured per source
   (HUD User: 60/minute), beside the daily budget, with long caching (fiscal-year data is fixed once
   published). *The owner expects to revisit this* (e.g. per-IP versus per-token behaviour on the
   hosted server); the limiter is a core option precisely so it can change without touching servers.
6. **Token and attribution:** `HUD_USER_TOKEN` is a sensitive Terraform variable set on the Lambda
   (ADR-006), from `.env` by `scripts/deploy.sh`. The required sentence — "This product uses the HUD
   User Data API but is not endorsed or certified by HUD User." — is in `hud_describe_source`, the
   server instructions and every citation.
7. **Deployment:** `huduser.responsive.city/mcp`, service `rc-huduser-mcp`, its own module, instance
   entry and admin-created execution role (ADR-007, ADR-016).
8. **Release:** v0.6.0.

## Amendments to ADR-015

- §2: "CDC PLACES and HUD are guides" becomes "CDC PLACES and **HUD Open Data (ArcGIS Hub)** are
  guides; the **HUD User API** is a server (ADR-018): it meets all three conditions — an id grammar, a
  quota, and a citation contract."
- §6 gains: *a connector limitation that blocks **access** (not policy) is a release blocker for the
  guide that depends on it; it is filed upstream and gets a guided-run eval case that fails until it
  is fixed.*

## Consequences

- A fourth agency server, fifth Lambda. The per-minute limiter benefits every server.
- Suppression and vintage become envelope data for HUD: Picture's `-1`, CHAS's release period, the
  fiscal year of an FMR.
- HUD questions now have two surfaces; the HUD guide points rent, income-limit, CHAS and Picture
  questions to the server and inventories to the connector.

## Alternatives rejected

- **One server for all of HUD (option C).** Re-implements a portal client for about eight Hub layers
  a fixed connector already serves.
- **An OpenContext custom plugin for the HUD User API.** No envelope, geography or contract, and a
  shared token inside a portal config.

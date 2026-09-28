/**
 * Records the fixtures `rpp-indicators.test.ts` replays (#261, ADR-019 §2). Run:
 *
 *   set -a && . ./.env && set +a
 *   npx tsx --conditions development packages/server-bea/scripts/record-rpp-fixtures.mts
 *
 * Every query here is exactly what `rppFetch` (`../src/rpp-indicators.ts`) builds at runtime for
 * the test cases (metro direct, an item pick, state, an explicit-year history, a county/city →
 * metro fallback, a no-metro place's state nonmetropolitan portion (`PARPP`), and two
 * `compare_places` batches — one all-MARPP, one MARPP+PARPP) — so the fixture URLs match what the
 * tests request.
 */
import { recordBeaFixtures } from "./record-bea-fixtures.mts";
import type { BeaQuery } from "../src/bea-api.js";

const queries: BeaQuery[] = [
  // Denver metro, all items, latest (BEA's LAST5 default).
  { table: "MARPP", lineCode: 1, geoFips: "19740" },
  // Denver metro, rents, 2024 — the `item` picker.
  { table: "MARPP", lineCode: 3, geoFips: "19740", year: "2024" },
  // Indiana state, all items, latest.
  { table: "SARPP", lineCode: 1, geoFips: "18000" },
  // Denver metro, all items, explicit 2023-2024 — history, newest first.
  { table: "MARPP", lineCode: 1, geoFips: "19740", year: "2024,2023" },
  // South Bend metro alone, all items, latest — St. Joseph County and South Bend city both
  // fall back to this; also the MARPP half of the St. Joseph + Cook compare.
  { table: "MARPP", lineCode: 1, geoFips: "43780" },
  // Loving County, TX has no metro: Texas's nonmetropolitan portion (PARPP), all items, latest.
  { table: "PARPP", lineCode: 1, geoFips: "48999" },
  // Two metros in one call — compare_places batching.
  { table: "MARPP", lineCode: 1, geoFips: ["19740", "43780"] },
  // St. Joseph County (South Bend metro) + Cook County (Chicago metro) compared: one MARPP call.
  { table: "MARPP", lineCode: 1, geoFips: ["43780", "16980"] },
  // Marshall County, IN is micropolitan: Indiana's nonmetropolitan portion, latest.
  { table: "PARPP", lineCode: 1, geoFips: "18999" },
];

await recordBeaFixtures(queries);

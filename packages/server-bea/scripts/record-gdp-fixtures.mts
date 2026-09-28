/**
 * Records the GDP-by-industry fixtures `gdp-indicators.test.ts` replays (#260, ADR-019 §5).
 *
 * set -a && . ./.env && set +a
 * npx tsx --conditions development packages/server-bea/scripts/record-gdp-fixtures.mts
 *
 * Covers: St. Joseph County IN direct current-dollar and real GDP (default years), an industry
 * pick (construction, line 11) at St. Joseph, Loving County TX construction (the verified `(D)`
 * suppression case), Indiana state GDP, an explicit-year history range at St. Joseph, the
 * Albemarle+Charlottesville, VA combination (51901), and the St. Joseph + Cook compare-batching
 * call (one `beaGetData` call, GeoFips list `18141,17031`).
 */
import { recordBeaFixtures } from "./record-bea-fixtures.mts";

await recordBeaFixtures([
  // St. Joseph County IN: current-dollar GDP, all industries, default years.
  { table: "CAGDP2", lineCode: 1, geoFips: "18141" },
  // St. Joseph County IN: real GDP, all industries, default years (verifies 2023 = 15,118,595).
  { table: "CAGDP9", lineCode: 1, geoFips: "18141" },
  // St. Joseph County IN: current-dollar GDP, construction (line 11) — the industry pick case.
  { table: "CAGDP2", lineCode: 11, geoFips: "18141" },
  // Loving County TX: real GDP, construction (line 11) — verified (D) suppressed, 2023.
  { table: "CAGDP9", lineCode: 11, geoFips: "48301" },
  // Indiana: state current-dollar GDP, all industries, default years.
  { table: "SAGDP2", lineCode: 1, geoFips: "18000" },
  // St. Joseph County IN: current-dollar GDP, an explicit multi-year history range.
  {
    table: "CAGDP2",
    lineCode: 1,
    geoFips: "18141",
    year: ["2023", "2022", "2021", "2020", "2019"],
  },
  // Albemarle + Charlottesville, VA (BEA's combination code 51901): current-dollar GDP.
  { table: "CAGDP2", lineCode: 1, geoFips: "51901" },
  // Compare batching: St. Joseph County IN + Cook County IL in ONE call, current-dollar GDP.
  { table: "CAGDP2", lineCode: 1, geoFips: ["18141", "17031"] },
]);

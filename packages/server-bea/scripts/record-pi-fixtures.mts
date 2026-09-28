/**
 * Records the fixtures `pi-indicators.test.ts` replays (#259). Run:
 *
 *   set -a && . ./.env && set +a
 *   npx tsx --conditions development packages/server-bea/scripts/record-pi-fixtures.mts
 *
 * Queries cover: a county direct (St. Joseph, IN — personal_income, latest), the same county+Cook
 * County batched in one call (compare_places), a county's per-capita history 2021-2024 (verified
 * live figures), a state's annual and quarterly personal income (Indiana), a Virginia combination
 * (Albemarle+Charlottesville, 51901) and a Connecticut planning region (Capitol, 09110) asked for
 * 2020-2024. See `recordBeaFixtures` (`scripts/record-bea-fixtures.mts`) for the shared machinery.
 */
import type { BeaQuery } from "../src/bea-api.js";
import { recordBeaFixtures } from "./record-bea-fixtures.mjs";

const QUERIES: BeaQuery[] = [
  // St. Joseph County, IN — personal_income, latest (BEA default LAST5; the newest is kept).
  { table: "CAINC1", lineCode: 1, geoFips: "18141" },
  // St. Joseph + Cook County in one call — compare_places batching.
  { table: "CAINC1", lineCode: 1, geoFips: ["18141", "17031"] },
  // St. Joseph County per capita personal income, 2021-2024 (verified live 2026-09-28).
  { table: "CAINC1", lineCode: 3, geoFips: "18141", year: ["2021", "2022", "2023", "2024"] },
  // Indiana, state annual personal income, latest.
  { table: "SAINC1", lineCode: 1, geoFips: "18000" },
  // Indiana, state quarterly per capita personal income, 2026 (2026Q1 verified live 2026-09-28).
  { table: "SQINC1", lineCode: 3, geoFips: "18000", year: ["2026"] },
  // Albemarle County, VA: BEA publishes it combined with Charlottesville city as 51901.
  { table: "CAINC1", lineCode: 1, geoFips: "51901" },
  // Connecticut's Capitol Planning Region, asked for 2020-2024 (regions begin 2024).
  {
    table: "CAINC1",
    lineCode: 1,
    geoFips: "09110",
    year: ["2020", "2021", "2022", "2023", "2024"],
  },
];

await recordBeaFixtures(QUERIES);

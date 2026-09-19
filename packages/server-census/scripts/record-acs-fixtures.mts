/**
 * Records the ACS/decennial fixtures the server-census tests replay (CLAUDE.md: agency APIs are
 * never called in unit tests). Run ONCE, deliberately, with CENSUS_API_KEY in the environment:
 *
 *   npx tsx --conditions development packages/server-census/scripts/record-acs-fixtures.mts
 *
 * The key rides as `queryAuth`, so it is never part of the fixture path or file (ADR-014 §9).
 * The URL shape must match `acs.ts`'s builder exactly — same parameter order — or the replay
 * misses. Recorded 2026-09-19: ACS 2024 1-year/5-year and the 2020 decennial redistricting file.
 */
import { createHttpClient, MemoryBudgetStore, MemoryCacheStore } from "@federal-mcps/core";
const key = process.env["CENSUS_API_KEY"];
if (!key) throw new Error("CENSUS_API_KEY missing");
const client = createHttpClient({
  source: "census",
  budget: new MemoryBudgetStore(100),
  cache: new MemoryCacheStore(),
  fixtures: { mode: "record", dir: process.argv[2] ?? "packages/server-census/fixtures" },
});
const E = "https://api.census.gov/data";
const acs = (v: string) => `NAME,${v}E,${v}M,${v}EA,${v}MA`;
const cases: [string, string, string, string][] = [
  ["2024", "acs/acs1", acs("B01003_001"), "1600000US0820000"], // Denver city, controlled MOE
  ["2024", "acs/acs1", acs("B19013_001"), "1600000US0820000"],
  ["2024", "acs/acs1", acs("B01003_001"), "1600000US0465350"], // Sedona: 204, below 65k
  ["2024", "acs/acs5", acs("B01003_001"), "1600000US0465350"],
  ["2024", "acs/acs5", acs("B19013_001"), "1600000US0465350"],
  ["2024", "acs/acs5", acs("B19013_001"), "0500000US08031"],
  ["2024", "acs/acs5/subject", acs("S1701_C03_001"), "0500000US08031"], // percent, subject
  ["2024", "acs/acs5", acs("B19013_001"), "1400000US08031980001"], // sentinel median
  ["2024", "acs/acs5", acs("B19013_001"), "1400000US08031000503"], // low reliability
  ["2020", "dec/pl", "NAME,P1_001N", "0500000US08031"], // decennial
];
for (const [vintage, dataset, get, ucgid] of cases) {
  const url = `${E}/${vintage}/${dataset}?get=${get}&ucgid=${ucgid}`;
  const res = await client.getText(url, { queryAuth: { key } });
  console.error(`${res.status} ${dataset} ${get.split(",")[1]} ${ucgid}: ${res.value.slice(0, 90).replace(/\n/g, " ")}`);
}

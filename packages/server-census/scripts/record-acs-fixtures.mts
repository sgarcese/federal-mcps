/**
 * Records the ACS/decennial fixtures the server-census tests replay (CLAUDE.md: agency APIs are
 * never called in unit tests). Run ONCE, deliberately, with CENSUS_API_KEY in the environment:
 *
 *   npx tsx --conditions development packages/server-census/scripts/record-acs-fixtures.mts
 *
 * The key rides as `queryAuth`, so it is never part of the fixture path or file (ADR-014 §9).
 * The URL shape must match `acs.ts`'s builder exactly — same parameter order — or the replay
 * misses. Recorded 2026-09-19: ACS 2024 1-year/5-year and the 2020 decennial redistricting file.
 *
 * The `census_get_raw` case below (#174) was added to this file's case list so its URL is built
 * by the SAME function the tool uses (`buildRawQueryUrl`), but the fixture it names —
 * `packages/server-census/fixtures/census/8fc8f9e696358fcae4a601f7d9dde079fe271d591caf56cf9d9aa5c6e61799e7.json`
 * — recorded with the real key on 2026-09-19 (Denver County median household income 94,718 ± 1,644).
 * Re-record it for real the next time this script runs with a key.
 */
import { createHttpClient, MemoryBudgetStore, MemoryCacheStore } from "@federal-mcps/core";
import { buildRawQueryUrl } from "../src/get-raw.js";
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
  console.error(
    `${res.status} ${dataset} ${get.split(",")[1]} ${ucgid}: ${res.value.slice(0, 90).replace(/\n/g, " ")}`,
  );
}

// census_get_raw (#174): Denver County median household income, its URL built by the tool's own
// builder so this file stays the single source of truth for every replayed Census URL.
{
  const url = buildRawQueryUrl({
    dataset: "acs/acs5",
    year: 2024,
    ids: ["NAME", "B19013_001E", "B19013_001M"],
    ucgid: "0500000US08031",
    descriptive: false,
  });
  const res = await client.getText(url, { queryAuth: { key } });
  console.error(`${res.status} census_get_raw ${url}: ${res.value.slice(0, 90)}`);
}

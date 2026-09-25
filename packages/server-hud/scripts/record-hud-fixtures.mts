/**
 * Records the HUD User API fixtures the server-hud tests replay (#232). Run by a person with
 * HUD_USER_TOKEN in the environment (never an agent, never CI):
 *
 *   set -a; source .env; set +a
 *   npx tsx --conditions development packages/server-hud/scripts/record-hud-fixtures.mts
 *
 * The token rides as a header; fixtures are keyed by URL and store only the response, so it never
 * reaches disk (a test asserts no fixture contains an Authorization header). Built with the same
 * URL builders the server uses, so the hashes match. 60 queries/minute: the core limiter paces it.
 */
import { fileURLToPath } from "node:url";
import { createHttpClient, MemoryBudgetStore, MemoryCacheStore } from "@federal-mcps/core";
import { chasUrl, fmrUrl, hudGetJson, ilUrl, mtspUrl, pictureUrl } from "../src/hud-api.js";

// biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature.
const token = () => process.env["HUD_USER_TOKEN"];
if (!token()) throw new Error("HUD_USER_TOKEN missing");
const client = createHttpClient({
  source: "hud",
  budget: new MemoryBudgetStore(500),
  cache: new MemoryCacheStore(),
  perMinute: 55,
  fixtures: { mode: "record", dir: fileURLToPath(new URL("../fixtures", import.meta.url)) },
});

const ST_JOSEPH = "1814199999";
const COOK = "1703199999"; // a Small Area FMR county
const urls = [
  // FMR: current, history, the 2016 floor (400), a SAFMR county
  fmrUrl(ST_JOSEPH),
  fmrUrl(ST_JOSEPH, 2026),
  fmrUrl(ST_JOSEPH, 2025),
  fmrUrl(ST_JOSEPH, 2017),
  fmrUrl(ST_JOSEPH, 2016),
  fmrUrl(COOK),
  // Income Limits and MTSP
  ilUrl(ST_JOSEPH),
  ilUrl(ST_JOSEPH, 2025),
  ilUrl(ST_JOSEPH, 2017),
  mtspUrl(ST_JOSEPH),
  // CHAS: county latest and one earlier release, the state, South Bend
  chasUrl({ type: 3, stateId: 18, entityId: 141 }),
  chasUrl({ type: 3, stateId: 18, entityId: 141 }, "2017-2021"),
  chasUrl({ type: 2, stateId: 18 }),
  chasUrl({ type: 5, stateId: 18, entityId: 71000 }),
  // Picture: county 2024, 2025 (sub-program rows), 2012 (strings, census 2010), city, CBSA
  pictureUrl({ type: 9, statecode: "IN", entityid: "18141" }, 2024),
  pictureUrl({ type: 9, statecode: "IN", entityid: "18141" }, 2025),
  pictureUrl({ type: 9, statecode: "IN", entityid: "18141" }, 2012),
  pictureUrl({ type: 8, statecode: "IN", entityid: "1871000" }, 2024),
  pictureUrl({ type: 5, entityid: "43780" }, 2024),
];

for (const url of urls) {
  const body = await hudGetJson<unknown>(client, url, token);
  process.stdout.write(`${body === undefined ? "no data" : "recorded"}  ${url}\n`);
}

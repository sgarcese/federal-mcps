/**
 * Shared fixture recorder for the BEA server (#253 wave seam). Each family's script
 * (`scripts/record-<family>-fixtures.mts`) passes the GetData queries its tests replay:
 *
 *   set -a && . ./.env && set +a
 *   npx tsx --conditions development packages/server-bea/scripts/record-pi-fixtures.mts
 *
 * The key rides as `queryAuth` (never in a URL, cache key or fixture name), and the client's
 * `sanitize` hook strips BEA's echo of it from every body before the fixture is written; the recorder
 * then asserts no fixture on disk contains the key. Queries are built with `beaDataUrl`, the same
 * builder the server uses, so the hashes match. Paced by the core limiter (BEA allows 100/minute).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpClient, MemoryBudgetStore, MemoryCacheStore } from "@federal-mcps/core";
import {
  BEA_PER_MINUTE,
  type BeaQuery,
  beaBodyError,
  beaGetData,
  sanitizeBeaBody,
} from "../src/bea-api.js";

export const FIXTURE_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

export async function recordBeaFixtures(queries: readonly BeaQuery[]): Promise<void> {
  // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature.
  const key = process.env["BEA_API_KEY"];
  if (!key) throw new Error("BEA_API_KEY missing (set -a && . ./.env && set +a)");
  const client = createHttpClient({
    source: "bea",
    budget: new MemoryBudgetStore(500),
    cache: new MemoryCacheStore(),
    perMinute: BEA_PER_MINUTE,
    sanitize: sanitizeBeaBody,
    bodyError: beaBodyError,
    fixtures: { mode: "record", dir: FIXTURE_DIR },
  });
  for (const q of queries) {
    const results = await beaGetData(client, q, key);
    process.stdout.write(
      `recorded ${q.table} line ${q.lineCode} ${String(q.geoFips)} ${String(q.year ?? "")}: ${results.Data?.length ?? 0} rows\n`,
    );
  }
  const dir = join(FIXTURE_DIR, "bea");
  for (const f of readdirSync(dir)) {
    if (readFileSync(join(dir, f), "utf-8").includes(key)) {
      throw new Error(`fixture ${f} contains the BEA key — do not commit it`);
    }
  }
}

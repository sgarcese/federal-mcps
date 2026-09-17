import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { assemble, type Sources } from "../assemble.js";
import { buildCatalog } from "../catalog.js";
import { loadVendoredGeocorr } from "../data/geocorr/vendored.js";
import { fetchCached, SOURCE_URLS } from "../download.js";

/**
 * Builds the catalog end to end: download (cached), unzip the gazetteers, assemble, and
 * write `dist/geo-catalog@<vintage>.sqlite`. Network — run by `npm run geography:build`
 * or the scheduled CI job, never in unit tests.
 *
 *   node dist/cli/build.js [vintage]     # default vintage: 2025
 */
async function main(): Promise<void> {
  const vintage = process.argv[2] ?? "2025";
  const outDir = join(import.meta.dirname, "..", "..", "dist");
  const outPath = join(outDir, `geo-catalog@${vintage}.sqlite`);

  const sources: Sources = { gazetteers: {} };

  for (const [sumlevel, url] of Object.entries(SOURCE_URLS.gazetteers)) {
    process.stderr.write(`gazetteer ${sumlevel}: ${url}\n`);
    const zip = await fetchCached(url);
    sources.gazetteers[sumlevel] = unzipSingleText(zip);
  }
  for (const key of [
    "lausArea",
    "cesArea",
    "oewsArea",
    "cpiArea",
    "zctaTract",
    "zctaCounty",
    "zctaPlace",
    "cdCounty",
    "cdPlace",
    "tractLineage",
  ] as const) {
    const url = SOURCE_URLS[key];
    process.stderr.write(`${key}: ${url}\n`);
    sources[key] = (await fetchCached(url)).toString("utf-8");
  }

  // Geocorr has no API and no stable download URL (ADR-008 §2), so its exports are vendored
  // in this package: the sample for cousub↔CBSA / ZCTA↔tract, and the full national
  // place→county crosswalk (#141) — the only source of that edge, which the LAUS below-
  // threshold county fallback (ADR-009 §6) depends on. Regenerate with `npm run geocorr:fetch`.
  sources.geocorr = loadVendoredGeocorr();

  const rows = assemble(sources);
  mkdirSync(outDir, { recursive: true });
  const db = new BetterSqlite3(outPath);
  buildCatalog(db, rows, { vintage });
  db.close();

  process.stderr.write(
    `built ${outPath}: ${rows.entities.length} entities, ${rows.agencyCodes.length} agency codes, ` +
      `${rows.containment.length} containment edges, ${rows.lineage.length} lineage rows\n`,
  );
}

/** Extracts the single `.txt` member of a gazetteer zip via the system `unzip`. */
function unzipSingleText(zip: Buffer): string {
  const tmp = join(
    mkdirSync(join(tmpdir(), `geo-${Date.now()}-${Math.random().toString(36).slice(2)}`), {
      recursive: true,
    }) ?? "",
    "g.zip",
  );
  writeFileSync(tmp, zip);
  // -p writes the (single) member to stdout; gazetteer zips contain one .txt.
  return execFileSync("unzip", ["-p", tmp], { maxBuffer: 256 * 1024 * 1024 }).toString("utf-8");
}

main().catch((err: unknown) => {
  process.stderr.write(`geography:build failed: ${String(err)}\n`);
  process.exitCode = 1;
});

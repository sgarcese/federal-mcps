/**
 * Derives the vendored OEWS occupation vocabulary `oe-indicators.ts` reads (#359, ADR-013 §2):
 * BLS's own occupation code list for the OE (OEWS) survey,
 * `https://download.bls.gov/pub/time.series/oe/oe.occupation` — a tab-separated file with one row
 * per SOC code BLS uses in the OE survey, including a `display_level` (0 = the 22 SOC major
 * groups plus "all occupations"; 3 = the ~830 detailed 6-digit occupations OEWS actually
 * publishes) and `selectable` (whether BLS's own LABSTAT selection tool offers the code). Codes
 * are "built, not typed" (CLAUDE.md): validating a detailed occupation argument against a
 * hand-typed table would silently go stale as BLS adds/retires SOC codes, so this script reads
 * BLS's list once and `oe-indicators.ts` validates against the vendored JSON it writes
 * (`src/data/oe-occupations.json`), never a literal table in source.
 *
 * BLS returns HTTP 403 to requests with no identifying User-Agent — a descriptive one with a
 * contact address is required (verified 2026-10-15: the default Node/curl UA is denied, a plain
 * "name (contact: email)" UA is served 200; a UA that itself contains a URL is denied too, so
 * keep it to a bare contact address). This is read once at build time and vendored, like
 * `server-bea/scripts/generate-gdp-lines.mts`'s bare `fetch` to BEA's metadata endpoint
 * (CLAUDE.md: agency APIs are never called in unit tests; the core HTTP client's quota/cache
 * discipline is for request-time data queries, not one-off build-time vendoring), so this uses a
 * bare `fetch` too, never the core client.
 *
 * Run deliberately, never in CI or tests:
 *
 *   npx tsx packages/server-bls/scripts/generate-oe-occupations.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_URL = "https://download.bls.gov/pub/time.series/oe/oe.occupation";
/** The day this script was actually run against the live file (#359) — set by hand, not `Date.now()`, so a rerun on another day does not silently claim a retrieval that did not happen. */
const RETRIEVED_AT = "2026-10-15";
/**
 * BLS denies requests with no identifying contact; see the module comment. A UA containing a
 * URL (even "https://...") is itself denied (verified 2026-10-15) — a bare contact works.
 */
const USER_AGENT = "federal-mcps (contact: sgarcese@gmail.com)";

export interface OeOccupationRow {
  readonly code: string;
  readonly name: string;
}

export interface OeOccupationVocabulary {
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  /** The 22 SOC major groups, plus "000000" (all occupations) — display_level 0. */
  readonly majorGroups: readonly OeOccupationRow[];
  /** The ~830 detailed 6-digit SOC occupations OEWS publishes — display_level 3, selectable. */
  readonly detailed: readonly OeOccupationRow[];
}

/** One parsed row of `oe.occupation`, or undefined for a malformed line. */
function parseRow(
  line: string,
): { code: string; name: string; displayLevel: string; selectable: string } | undefined {
  const [code, name, , displayLevel, selectable] = line.split("\t");
  if (!code || !name || displayLevel === undefined || selectable === undefined) return undefined;
  return { code, name, displayLevel, selectable };
}

export function parseOeOccupationFile(text: string): OeOccupationVocabulary {
  const lines = text.split("\n").slice(1); // header row
  const majorGroups: OeOccupationRow[] = [];
  const detailed: OeOccupationRow[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const row = parseRow(line);
    if (!row) continue;
    if (row.displayLevel === "0") {
      majorGroups.push({ code: row.code, name: row.name });
    } else if (row.displayLevel === "3" && row.selectable === "T") {
      detailed.push({ code: row.code, name: row.name });
    }
  }
  return {
    sourceUrl: SOURCE_URL,
    retrievedAt: RETRIEVED_AT,
    majorGroups,
    detailed,
  };
}

async function main(): Promise<void> {
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`oe.occupation: HTTP ${res.status}`);
  const text = await res.text();
  const vocabulary = parseOeOccupationFile(text);

  console.error(
    `${vocabulary.majorGroups.length} major groups, ${vocabulary.detailed.length} detailed occupations`,
  );

  const outDir = join(import.meta.dirname, "..", "src", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "oe-occupations.json");
  writeFileSync(outPath, JSON.stringify(vocabulary, null, 2));
  console.error(`wrote ${outPath}`);
}

// Only run when invoked directly (`tsx generate-oe-occupations.mts`), not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

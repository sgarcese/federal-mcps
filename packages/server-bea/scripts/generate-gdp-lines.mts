/**
 * Derives the vendored GDP line-code vocabulary `gdp-indicators.ts` reads (#260, ADR-019 §2, §5).
 *
 * BEA's Regional line codes are not typed: this script calls the BEA Data API's PUBLIC parameter
 * metadata method (`GetParameterValuesFiltered&TargetParameter=LineCode`) for each of the four GDP
 * tables (`CAGDP2`, `CAGDP9` — county current-dollar and real GDP; `SAGDP2`, `SAGDP9` — the state
 * equivalents) and writes each table's `{ code, label, naics }` rows to
 * `packages/server-bea/src/data/gdp-lines.json`. `naics` is parsed from the trailing parenthetical
 * in BEA's own description (`"[CAGDP9] Real GDP: Construction (23)"` → `"23"`); `null` for the two
 * rows with none ("All industry total", "Private industries" — BEA's own line 1 and line 2, the
 * `all`/`private` vocabulary entries `gdp-indicators.ts` special-cases).
 *
 * This still needs a registered key (metadata calls are not keyless, unlike Census's), so — like
 * every BEA call — it goes through the core HTTP client only when it is a DATA call; this is
 * parameter metadata, read once at build time and vendored, so it uses a bare `fetch` the same way
 * `server-census/scripts/build-table-index.mts` does for Census's keyless metadata (CLAUDE.md:
 * agency APIs are never called in unit tests; the core client's quota/cache discipline is for data
 * queries the server makes at request time, not one-off build-time vendoring). The key rides only
 * as a query parameter on an outbound request that is never logged, echoed to a file, or retried in
 * a loop — never printed, never written to `gdp-lines.json`.
 *
 * Run deliberately, never in CI or tests:
 *
 *   set -a && . ./.env && set +a
 *   npx tsx --conditions development packages/server-bea/scripts/generate-gdp-lines.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The four GDP-by-industry tables ADR-019 §2/§5 names. */
const TABLES = ["CAGDP2", "CAGDP9", "SAGDP2", "SAGDP9"] as const;
type Table = (typeof TABLES)[number];

export interface GdpLineRow {
  /** BEA's LineCode, as a string (the code `beaDataUrl`'s `lineCode` takes). */
  readonly code: string;
  /** The industry label, BEA's description with the table prefix and NAICS parenthetical stripped. */
  readonly label: string;
  /** The NAICS code or range parsed from the description ("23", "31-33", "321,327-339"), or null. */
  readonly naics: string | null;
}

export type GdpLines = Record<Table, readonly GdpLineRow[]>;

interface BeaParamValue {
  readonly Key?: string;
  readonly Desc?: string;
}

/**
 * Parses one BEA `ParamValue` row into a `GdpLineRow`: strips the `[TABLE] <Statistic>: ` prefix
 * BEA repeats on every description, and pulls the trailing `(...)` as the NAICS code — the last
 * parenthesized group, since some labels also parenthesize the statistic name itself.
 */
export function parseLineRow(row: BeaParamValue): GdpLineRow | undefined {
  const code = row.Key?.trim();
  const desc = row.Desc?.trim();
  if (!code || !desc) return undefined;
  const afterColon = desc.replace(/^\[[^\]]+\]\s*[^:]*:\s*/, "");
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(afterColon);
  return match
    ? { code, label: match[1] ?? afterColon, naics: match[2] ?? null }
    : { code, label: afterColon, naics: null };
}

async function fetchLines(table: Table, apiKey: string): Promise<readonly GdpLineRow[]> {
  const url =
    "https://apps.bea.gov/api/data" +
    `?method=GetParameterValuesFiltered&datasetname=Regional&TargetParameter=LineCode&TableName=${table}` +
    `&ResultFormat=JSON&UserID=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GetParameterValuesFiltered ${table}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    BEAAPI?: { Results?: { ParamValue?: readonly BeaParamValue[] } };
  };
  const rows = body.BEAAPI?.Results?.ParamValue ?? [];
  const parsed: GdpLineRow[] = [];
  for (const row of rows) {
    const line = parseLineRow(row);
    if (line) parsed.push(line);
  }
  parsed.sort((a, b) => Number(a.code) - Number(b.code));
  return parsed;
}

async function main(): Promise<void> {
  // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature.
  const apiKey = process.env["BEA_API_KEY"];
  if (!apiKey) throw new Error("BEA_API_KEY missing (set -a && . ./.env && set +a)");

  const out: Partial<GdpLines> = {};
  for (const table of TABLES) {
    const rows = await fetchLines(table, apiKey);
    out[table] = rows;
    // Row counts only — never the URL (it carries the key).
    console.error(`${table}: ${rows.length} lines`);
  }

  const outDir = join(import.meta.dirname, "..", "src", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "gdp-lines.json");
  writeFileSync(outPath, JSON.stringify(out as GdpLines, null, 2));
  console.error(`wrote ${outPath}`);
}

// Only run when invoked directly (`tsx generate-gdp-lines.mts`), not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

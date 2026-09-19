import { ucgidOf } from "@federal-mcps/core";

/**
 * ACS 5-year total population (`B01003_001E`, ADR-014 §6, #172): parses the Census Data
 * API's documented response shape — a JSON array of arrays whose first row is the header
 * and every subsequent row is one geography's values (verified live 2026-09-18, see
 * `docs/spikes/m8-census.md`). One `SOURCE_URLS.acsPopulation` URL is fetched per summary
 * level; this module only parses already-decoded JSON, no network.
 *
 * The geography id columns come after the requested variables. For most levels a single
 * trailing column is the whole GEOID (state, CBSA, ZCTA, region, division); county and
 * place are nested under `state`, so their GEOID is `state + <level>`.
 */

/** Census sentinel values (ADR-014 decision 4, spike "verified"): never a real population. */
const SENTINELS = new Set([-666_666_666, -999_999_999, -888_888_888]);

/** Which header column(s) build the GEOID for each summary level, in order. */
const ID_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "020": ["region"],
  "030": ["division"],
  "040": ["state"],
  "050": ["state", "county"],
  "160": ["state", "place"],
  "310": ["metropolitan statistical area/micropolitan statistical area"],
  "860": ["zip code tabulation area"],
});

export function parseAcsPopulation(
  json: unknown,
  sumlevel: string,
): { ucgid: string; population: number | null }[] {
  if (!Array.isArray(json) || json.length === 0) return [];

  const header = json[0] as unknown[];
  if (!Array.isArray(header)) return [];
  const cols = header.map((c) => String(c));
  const iValue = cols.indexOf("B01003_001E");
  if (iValue < 0) {
    throw new Error(`ACS population: header lacks B01003_001E (got ${cols.join(",")})`);
  }

  const idColumns = ID_COLUMNS[sumlevel];
  if (!idColumns) {
    throw new Error(`ACS population: unsupported summary level ${sumlevel}`);
  }
  const idIdx = idColumns.map((name) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`ACS population: header lacks "${name}" (got ${cols.join(",")})`);
    return i;
  });

  if (json.length < 2) return [];

  const out: { ucgid: string; population: number | null }[] = [];
  for (const rawRow of json.slice(1)) {
    if (!Array.isArray(rawRow)) continue;
    const row = rawRow as (string | number | null)[];
    const geoid = idIdx.map((i) => (row[i] === null || row[i] === undefined ? "" : String(row[i]))).join("");
    if (!geoid) continue;

    const raw = row[iValue];
    out.push({ ucgid: ucgidOf(sumlevel, geoid), population: toPopulation(raw) });
  }
  return out;
}

function toPopulation(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || SENTINELS.has(n)) return null;
  return n;
}

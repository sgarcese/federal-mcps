import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Source URLs for the catalog build. Census 2025 gazetteer national files and the BLS
 * LABSTAT area tables. These are downloaded and cached; the cache directory is gitignored
 * (the built `.sqlite` is the release artifact, not its inputs).
 */
export const SOURCE_URLS = {
  gazetteers: {
    "040":
      "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_state_national.zip",
    "050":
      "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip",
    "160":
      "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip",
    "310":
      "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_cbsa_national.zip",
    "860":
      "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip",
  },
  lausArea: "https://download.bls.gov/pub/time.series/la/la.area",
  cesArea: "https://download.bls.gov/pub/time.series/sm/sm.area",
  oewsArea: "https://download.bls.gov/pub/time.series/oe/oe.area",
  cpiArea: "https://download.bls.gov/pub/time.series/cu/cu.area",
  qcewArea: "https://data.bls.gov/cew/doc/titles/area/area_titles.csv",
  // Census 2020 relationship files (ADR-008 §2, #55). Layouts verified live 2026-09-09.
  // Note: Census does not publish a 2020 place<->county relationship file (the `place/`
  // directory holds only place20<->place10 comparability); that edge is Geocorr-only.
  zctaTract:
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt",
  zctaCounty:
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
  zctaPlace:
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt",
  cdCounty:
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_county20_natl.txt",
  cdPlace:
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_place20_natl.txt",
  tractLineage:
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/tract/tab20_tract20_tract10_natl.txt",
  /**
   * ACS 5-year `B01003_001E` (total population), one URL per summary level (ADR-014 §6,
   * #172). The Census Data API requires a key on every data query — verified live
   * 2026-09-18, `docs/spikes/m8-census.md` — but the key is appended at request time only
   * (see `fetchCachedWithCensusKey`), never baked into these URLs, so it never reaches a
   * cache file name, a log line, or this constant. Vintages run through 2024 (2025 is not
   * yet published); default vintage is therefore 2024, not the catalog's own vintage arg.
   */
  acsPopulation: (vintage = "2024"): Record<string, string> => ({
    "040": acsPopulationUrl(vintage, "state"),
    "050": acsPopulationUrl(vintage, "county"),
    "160": acsPopulationUrl(vintage, "place"),
    "310": acsPopulationUrl(vintage, "metropolitan statistical area/micropolitan statistical area"),
    "860": acsPopulationUrl(vintage, "zip code tabulation area"),
    "020": acsPopulationUrl(vintage, "region"),
    "030": acsPopulationUrl(vintage, "division"),
  }),
} as const;

function acsPopulationUrl(vintage: string, forLevel: string): string {
  return `https://api.census.gov/data/${vintage}/acs/acs5?get=NAME,B01003_001E&for=${encodeURIComponent(forLevel)}:*`;
}

/**
 * Reads `CENSUS_API_KEY` or throws loudly, naming the variable and the free sign-up URL
 * (ADR-014 §6, #172). `geography:build` must fail before downloading anything when this is
 * unset — a build without a key can silently ship a catalog with no population column.
 */
export function requireCensusApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env["CENSUS_API_KEY"];
  if (!key) {
    throw new Error(
      "CENSUS_API_KEY is not set. geography:build needs a Census Data API key to fetch ACS " +
        "population (ADR-014 §6, #172) — every Census data query now requires one. Sign up " +
        "for a free key at https://api.census.gov/data/key_signup.html and set " +
        "CENSUS_API_KEY before running geography:build.",
    );
  }
  return key;
}

const DEFAULT_CACHE_DIR = join(import.meta.dirname, "..", "downloads");

/**
 * Fetches a URL, caching the raw bytes under a content-addressed path so re-runs are
 * offline. BLS requires a descriptive User-Agent with a contact address.
 *
 * `fetchUrl`, when given, is the URL actually requested over the network, while `url`
 * still drives the cache key/path and appears in any error message — this is how a
 * sensitive query string (a Census API key) is fetched without ever touching a cache file
 * name, a log line, or an error (`fetchCachedWithCensusKey` below).
 */
export async function fetchCached(
  url: string,
  options: {
    cacheDir?: string;
    userAgent?: string;
    fetchImpl?: typeof fetch;
    fetchUrl?: string;
  } = {},
): Promise<Buffer> {
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const key = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const cachePath = join(cacheDir, `${key}-${basename(url)}`);

  try {
    return await readFile(cachePath);
  } catch {
    // cache miss — fall through to fetch
  }

  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(options.fetchUrl ?? url, {
    headers: {
      "user-agent": options.userAgent ?? "federal-mcps geography-build (sgarcese@gmail.com)",
    },
  });
  if (!res.ok) {
    // Deliberately reports `url` (the key-less form), never `options.fetchUrl`.
    throw new Error(`download failed ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, buf);
  return buf;
}

/**
 * Fetches a Census Data API URL with `&key=<key>` appended at request time only (ADR-014
 * §6, #172): `fetchCached` hashes and names the cache file from the key-less `url`, so the
 * key never appears in the cache directory, and never appears in a thrown error either
 * (`fetchCached` reports the key-less URL on failure). Callers get `requireCensusApiKey`'s
 * value and never log the appended URL themselves.
 */
export async function fetchCachedWithCensusKey(
  url: string,
  key: string,
  options: { cacheDir?: string; userAgent?: string; fetchImpl?: typeof fetch } = {},
): Promise<Buffer> {
  const separator = url.includes("?") ? "&" : "?";
  return fetchCached(url, { ...options, fetchUrl: `${url}${separator}key=${key}` });
}

function basename(url: string): string {
  const clean = url.split("?")[0] ?? url;
  return clean.slice(clean.lastIndexOf("/") + 1) || "download";
}

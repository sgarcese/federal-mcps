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
} as const;

const DEFAULT_CACHE_DIR = join(import.meta.dirname, "..", "downloads");

/**
 * Fetches a URL, caching the raw bytes under a content-addressed path so re-runs are
 * offline. BLS requires a descriptive User-Agent with a contact address.
 */
export async function fetchCached(
  url: string,
  options: { cacheDir?: string; userAgent?: string; fetchImpl?: typeof fetch } = {},
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
  const res = await doFetch(url, {
    headers: {
      "user-agent": options.userAgent ?? "federal-mcps geography-build (sgarcese@gmail.com)",
    },
  });
  if (!res.ok) {
    throw new Error(`download failed ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, buf);
  return buf;
}

function basename(url: string): string {
  const clean = url.split("?")[0] ?? url;
  return clean.slice(clean.lastIndexOf("/") + 1) || "download";
}

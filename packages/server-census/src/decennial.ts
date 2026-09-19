import type {
  IndicatorDefinition,
  IndicatorFetch,
  PlaceCandidate,
  SeriesResult,
} from "@federal-mcps/core";
import { CENSUS_API_ENDPOINT } from "./describe-source.js";

/**
 * Decennial 2020 population (ADR-014 §10): the redistricting file's P1_001N count for any area,
 * with no margin of error (a count, not an estimate). Series key `dec:2020:P1_001N:<ucgid>`.
 */
export const DECENNIAL_PROGRAM = "DEC";
const DECENNIAL_VINTAGE = "2020";
const DECENNIAL_VARIABLE = "P1_001N";
const DECENNIAL_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

export function buildDecennialQueryUrl(ucgid: string): string {
  return `${CENSUS_API_ENDPOINT}/${DECENNIAL_VINTAGE}/dec/pl?get=NAME,${DECENNIAL_VARIABLE}&ucgid=${ucgid}`;
}

export function buildDecennialSeriesKey(ucgid: string): string {
  return `dec:${DECENNIAL_VINTAGE}:${DECENNIAL_VARIABLE}:${ucgid}`;
}

export const decennialFetch: IndicatorFetch = async (
  client,
  keys,
  options,
): Promise<SeriesResult[]> => {
  const request = {
    freshTtlSeconds: DECENNIAL_CACHE_TTL_SECONDS,
    ...(options.apiKey ? { queryAuth: { key: options.apiKey } } : {}),
  };
  const results: SeriesResult[] = [];
  for (const key of keys) {
    const ucgid = key.split(":")[3];
    if (!ucgid) {
      results.push({ seriesId: key, observations: [] });
      continue;
    }
    const text = (await client.getText(buildDecennialQueryUrl(ucgid), request)).value;
    if (text.trim() === "") {
      results.push({ seriesId: key, observations: [] });
      continue;
    }
    const rows = JSON.parse(text) as (string | null)[][];
    const i = rows[0]?.indexOf(DECENNIAL_VARIABLE) ?? -1;
    const raw = i >= 0 ? rows[1]?.[i] : null;
    const value = raw === null || raw === undefined ? null : Number(raw);
    results.push({
      seriesId: key,
      observations: [
        {
          year: DECENNIAL_VINTAGE,
          period: "A01",
          periodName: `April 1, ${DECENNIAL_VINTAGE}`,
          value: Number.isFinite(value) ? value : null,
          footnotes: [
            {
              code: "DEC",
              text: "a decennial census count (2020 redistricting data), not an estimate; no margin of error",
            },
          ],
          marginOfError: null,
        },
      ],
    });
  }
  return results;
};

export const decennialIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "decennial_population",
    program: DECENNIAL_PROGRAM,
    description:
      "Total population counted by the 2020 Census (redistricting file P1_001N); a count, not an estimate.",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: (place: PlaceCandidate) => place.ucgid,
    buildSeriesId: (code) => buildDecennialSeriesKey(code),
    fetch: decennialFetch,
  },
];

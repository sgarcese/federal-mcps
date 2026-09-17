import type { HttpClient, PlaceCandidate } from "@federal-mcps/core";
import {
  fetchQcewHeadline,
  latestPublishedQuarter,
  priorQuarter,
  type QcewHeadline,
  qcewDisclosureText,
} from "./qcew.js";
import type { IndicatorDefinition } from "./registry.js";
import type { IndicatorFetch, SeriesObservation, SeriesResult } from "./series-fetch.js";

/**
 * QCEW registered as indicators (ADR-011 §1, §3, §4) using the fetch-capability seam (#123) over the
 * CSV client (#124). County and state resolve to their QCEW area code from the GEOID; the capability
 * fetches the latest published quarter's total-covered, all-industries headline and returns the
 * requested measure. Suppressed cells travel as a footnote with a null value — never fabricated.
 * Metro (the QCEW `C`-code) is a follow-up.
 */
const QCEW_PROGRAM = "QCEW";
const COUNTY_SUMLEVEL = "050";
const STATE_SUMLEVEL = "040";
/** A quarter is fixed once released, so cache the slice for 30 days. */
const QCEW_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
/** How many quarters to walk back if the newest expected slice isn't published yet. */
const QCEW_MAX_LOOKBACK = 3;

/** The QCEW area code for a place: county = 5-digit FIPS, state = SS000. Undefined otherwise. */
export function qcewAreaCodeOf(place: PlaceCandidate): string | undefined {
  if (place.kind.sumlevel === COUNTY_SUMLEVEL) return place.geoid; // 5-digit county FIPS
  if (place.kind.sumlevel === STATE_SUMLEVEL) return `${place.geoid}000`; // SS000 statewide
  return undefined;
}

type QcewMeasure = "employment" | "wage";

/** Fetch the latest published QCEW headline for an area, walking back a few quarters if needed. */
async function fetchLatestHeadline(
  client: HttpClient,
  area: string,
): Promise<QcewHeadline | undefined> {
  let q = latestPublishedQuarter(new Date());
  for (let i = 0; i < QCEW_MAX_LOOKBACK; i++) {
    const headline = await fetchQcewHeadline(client, area, q, {
      freshTtlSeconds: QCEW_CACHE_TTL_SECONDS,
    });
    if (headline) return headline;
    q = priorQuarter(q);
  }
  return undefined;
}

/** Turn a headline into one observation for the requested measure (null value + footnote if suppressed). */
function toObservation(headline: QcewHeadline, measure: QcewMeasure): SeriesObservation {
  const value = measure === "employment" ? headline.employment : headline.averageWeeklyWage;
  const disclosure = qcewDisclosureText(headline.disclosureCode);
  return {
    year: String(headline.year),
    period: `Q0${headline.quarter}`,
    periodName: `Quarter ${headline.quarter}`,
    value,
    footnotes: disclosure ? [{ code: headline.disclosureCode, text: disclosure }] : [],
  };
}

/** A fetch capability for a QCEW measure: one area (key) → its latest-quarter observation. */
function qcewFetch(measure: QcewMeasure): IndicatorFetch {
  return async (client, areaCodes): Promise<SeriesResult[]> => {
    const results: SeriesResult[] = [];
    for (const area of areaCodes) {
      const headline = await fetchLatestHeadline(client, area);
      results.push({
        seriesId: area,
        observations: headline ? [toObservation(headline, measure)] : [],
      });
    }
    return results;
  };
}

/** QCEW covered employment and average weekly wage (county + state), not seasonally adjusted. */
export const qcewIndicatorDefinitions: IndicatorDefinition[] = [
  {
    name: "covered_employment",
    program: QCEW_PROGRAM,
    description:
      "QCEW covered employment, all industries (quarterly average of the monthly levels).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: qcewAreaCodeOf,
    buildSeriesId: (code) => code, // the QCEW "key" is the area code
    fetch: qcewFetch("employment"),
  },
  {
    name: "average_weekly_wage",
    program: QCEW_PROGRAM,
    description: "QCEW average weekly wage, all industries (dollars).",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: qcewAreaCodeOf,
    buildSeriesId: (code) => code,
    fetch: qcewFetch("wage"),
  },
];

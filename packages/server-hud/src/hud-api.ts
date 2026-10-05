/**
 * The HUD User API seam (#232, ADR-018 §4): entity ids built from a resolved place — never typed
 * — URL builders with a fixed parameter order (fixtures hash the exact URL), and one fetch that
 * sends the bearer token as a header (so it never enters the cache key, a fixture or an error
 * URL) and turns HUD's "no data" answers into `undefined` rather than a guess.
 *
 * Identifiers verified live 2026-09-24 (docs/spikes/m11-hud-user-server.md) and 2026-09-28 (#241):
 *   FMR / IL / MTSP  county → SSCCC99999 (St. Joseph IN = 1814199999). New England publishes by
 *                    town and answers a county id with 404: the town id is the Census county-
 *                    subdivision GEOID (Boston = 2502507000). Connecticut's towns were recoded
 *                    with the 2022 planning regions (Hartford 0900337070 → 0911037070); HUD takes
 *                    the new id for FMR from FY2026 and for IL/MTSP from FY2025, the 2020 id before.
 *   CHAS             type 2 state (stateId), 3 county (stateId + county), 5 place (stateId + place).
 *   Picture          type 3 state, 9 county, 8 city, 7 tract, 5 CBSA; entity ids are FIPS; state
 *                    by USPS code; `census` 2010 for 2012–2021, 2020 from 2022.
 */
import {
  type HttpClient,
  HttpError,
  type PlaceCandidate,
  uspsOfStateFips,
} from "@federal-mcps/core";
import { HUD_USER_API_ENDPOINT } from "./describe-source.js";

/** HUD's fiscal-year data is fixed once published: cache a response for 30 days. */
export const HUD_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Served stale past the fresh window when a refresh is refused or fails (#323): 4× fresh, capped at 90 days. */
export const HUD_STALE_TTL_SECONDS = 60 * 60 * 24 * 90;

const COUNTY = "050";
const STATE = "040";
const PLACE = "160";
const TRACT = "140";
const METRO = "310";

const COUSUB = "060";

/** New England states (FIPS): HUD publishes FMR and Income Limits there by town, not county. */
const NEW_ENGLAND = new Set(["09", "23", "25", "33", "44", "50"]);

/** True for a GEOID in a New England state, where HUD's FMR and Income Limits areas are towns. */
export function isNewEngland(geoid: string): boolean {
  return NEW_ENGLAND.has(geoid.slice(0, 2));
}

/**
 * Joins a recoded town's current id and its 2020 id (`0911037070~0900337070`); the URL builders
 * pick one by fiscal year. Never in a `hud_get_raw` id (its ids are letters and digits only).
 */
const TOWN_ID_SEPARATOR = "~";

/** The first fiscal year HUD takes a recoded Connecticut town's new id (verified 2026-09-28). */
const NEW_TOWN_ID_FROM = { fmr: 2026, il: 2025 } as const;

/**
 * The FMR / Income Limits / MTSP entity id for a place, or undefined when HUD has none at its
 * level: a county outside New England (SSCCC99999), or a New England town (its county-subdivision
 * GEOID, with its 2020 GEOID after a separator when the town was recoded, #241).
 */
export function fmrEntityOf(place: PlaceCandidate): string | undefined {
  const sumlevel = place.kind.sumlevel;
  if (sumlevel === COUNTY) return isNewEngland(place.geoid) ? undefined : `${place.geoid}99999`;
  if (sumlevel !== COUSUB || !isNewEngland(place.geoid)) return undefined;
  const before = place.agencyCodes?.find(
    (c) => c.agency === "census" && c.program === "GEOID2020",
  )?.code;
  return before && before !== place.geoid
    ? `${place.geoid}${TOWN_ID_SEPARATOR}${before}`
    : place.geoid;
}

/** The id HUD answers for `year`: a recoded town's 2020 id before `firstNewYear`, else its current id. */
function idForYear(entity: string, year: number | undefined, firstNewYear: number): string {
  const [current = entity, before] = entity.split(TOWN_ID_SEPARATOR);
  return before !== undefined && year !== undefined && year < firstNewYear ? before : current;
}

export interface ChasEntity {
  type: 2 | 3 | 5;
  stateId: number;
  entityId?: number;
}

/** The CHAS entity for a state, county or place; undefined elsewhere. */
export function chasEntityOf(place: PlaceCandidate): ChasEntity | undefined {
  const stateId = Number(place.geoid.slice(0, 2));
  switch (place.kind.sumlevel) {
    case STATE:
      return { type: 2, stateId };
    case COUNTY:
      return { type: 3, stateId, entityId: Number(place.geoid.slice(2)) };
    case PLACE:
      return { type: 5, stateId, entityId: Number(place.geoid.slice(2)) };
    default:
      return undefined;
  }
}

export interface PictureEntity {
  type: 3 | 5 | 7 | 8 | 9;
  statecode?: string;
  entityid?: string;
}

/** The Picture of Subsidized Households entity for a place; undefined for levels it does not publish. */
export function pictureEntityOf(place: PlaceCandidate): PictureEntity | undefined {
  const sumlevel = place.kind.sumlevel;
  if (sumlevel === METRO) return { type: 5, entityid: place.geoid };
  const statecode = uspsOfStateFips(place.geoid.slice(0, 2));
  if (!statecode) return undefined;
  switch (sumlevel) {
    case STATE:
      return { type: 3, statecode };
    case COUNTY:
      return { type: 9, statecode, entityid: place.geoid };
    case PLACE:
      return { type: 8, statecode, entityid: place.geoid };
    case TRACT:
      return { type: 7, statecode, entityid: place.geoid };
    default:
      return undefined;
  }
}

/** Picture's required census vintage for a data year (HUD's rule; 2022 accepts either, 2020 used). */
export function pictureCensusFor(year: number): 2010 | 2020 {
  return year <= 2021 ? 2010 : 2020;
}

const withYear = (url: string, year: number | undefined) =>
  year === undefined ? url : `${url}?year=${year}`;

export function fmrUrl(entity: string, year?: number): string {
  const id = idForYear(entity, year, NEW_TOWN_ID_FROM.fmr);
  return withYear(`${HUD_USER_API_ENDPOINT}/fmr/data/${id}`, year);
}

export function ilUrl(entity: string, year?: number): string {
  const id = idForYear(entity, year, NEW_TOWN_ID_FROM.il);
  return withYear(`${HUD_USER_API_ENDPOINT}/il/data/${id}`, year);
}

export function mtspUrl(entity: string, year?: number): string {
  const id = idForYear(entity, year, NEW_TOWN_ID_FROM.il);
  return withYear(`${HUD_USER_API_ENDPOINT}/mtspil/data/${id}`, year);
}

/** A CHAS release is a period such as "2018-2022"; omitted → HUD's latest. */
export function chasUrl(entity: ChasEntity, release?: string): string {
  const params = [`type=${entity.type}`, `stateId=${entity.stateId}`];
  if (entity.entityId !== undefined) params.push(`entityId=${entity.entityId}`);
  if (release !== undefined) params.push(`year=${release}`);
  return `${HUD_USER_API_ENDPOINT}/chas?${params.join("&")}`;
}

export function pictureUrl(entity: PictureEntity, year: number): string {
  const params = [`type=${entity.type}`, `year=${year}`, `census=${pictureCensusFor(year)}`];
  if (entity.statecode !== undefined) params.push(`statecode=${entity.statecode}`);
  if (entity.entityid !== undefined) params.push(`entityid=${entity.entityid}`);
  return `${HUD_USER_API_ENDPOINT}/picture?${params.join("&")}`;
}

/**
 * GET one HUD User endpoint through the core client (rate-limited per minute, cached 30 days).
 * The token rides as an `Authorization` header — the fixtures and cache are keyed by URL and store
 * only the response, so it never lands on disk. HUD's "no data for this entity/year" (400, 404)
 * becomes `undefined`; anything else propagates.
 */
export async function hudGetJson<T>(
  client: HttpClient,
  url: string,
  token: () => string | undefined,
): Promise<T | undefined> {
  const bearer = token();
  if (!bearer) {
    throw new Error(
      "HUD_USER_TOKEN is not set: every HUD User API call needs a registered token (ADR-018 §6).",
    );
  }
  try {
    const { value } = await client.getJson<T>(url, {
      headers: { Authorization: `Bearer ${bearer}` },
      freshTtlSeconds: HUD_CACHE_TTL_SECONDS,
      staleTtlSeconds: HUD_STALE_TTL_SECONDS,
    });
    return value;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 400))
      return undefined;
    throw error;
  }
}

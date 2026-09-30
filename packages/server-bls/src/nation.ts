import type { PlaceCandidate } from "@federal-mcps/core";

/**
 * The nation (summary level 010, #290). The catalog carries the United States as a place, the
 * parent of every state; each BLS program answers it from its own national series (or says it has
 * none), so a local figure can sit beside a national benchmark.
 */
export const NATION_SUMLEVEL = "010";

/** The opaque "agency code" a program returns for the nation when its national id needs no area. */
export const NATION_CODE = "US";

export function isNation(place: Pick<PlaceCandidate, "kind">): boolean {
  return place.kind.sumlevel === NATION_SUMLEVEL;
}

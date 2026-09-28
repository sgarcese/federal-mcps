import type { AgencyCodeRow, EntityRow } from "../types.js";

/**
 * BEA's Regional GeoFips list (`GetParameterValuesFiltered`, `TableName=CAINC1`), read for the
 * areas BEA publishes in place of their components (#257, ADR-019 §6): 23 Virginia combination
 * areas — "one or two independent cities … combined with an adjacent county. The county name
 * appears first, followed by the city name(s)" (BEA's note) — and Maui + Kalawao, Hawaii.
 *
 * Each component county or independent city gets a `bea`/`GEOFIPS` code carrying its
 * combination's code, so it answers with the combination (and says so). Components are matched by
 * name within the state, at build time, from BEA's own list: the first name is the county
 * ("<name> County"), later names are cities ("<name> city", "Fairfax City" → "Fairfax city"),
 * falling back to a county where the state has no independent cities (Kalawao County). A
 * component that matches nothing fails the build — never a silent gap.
 */
export function parseBeaCombinations(
  listJson: string,
  entities: readonly EntityRow[],
): AgencyCodeRow[] {
  const values =
    (
      JSON.parse(listJson) as {
        BEAAPI?: { Results?: { ParamValue?: { Key: string; Desc: string }[] } };
      }
    ).BEAAPI?.Results?.ParamValue ?? [];
  const counties = new Map<string, EntityRow>();
  for (const e of entities) {
    if (e.sumlevel === "050") counties.set(`${e.geoid.slice(0, 2)}:${e.name.toLowerCase()}`, e);
  }

  const out: AgencyCodeRow[] = [];
  for (const { Key: code, Desc: desc } of values) {
    if (!desc.includes("+")) continue;
    const m = /^(.+),\s*([A-Z]{2})\*?$/.exec(desc.trim());
    if (!m?.[1]) throw new Error(`BEA combination "${desc}" (${code}): unexpected name shape`);
    const state = code.slice(0, 2);
    const parts = m[1]
      .split(/\s*\+\s*|,\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    const label = desc.replace(/\*$/, "");
    parts.forEach((part, i) => {
      const bare = part.replace(/\s+City$/, "");
      const candidates = i === 0 ? [`${part} County`] : [`${bare} city`, `${part} County`];
      const hit = candidates
        .map((name) => counties.get(`${state}:${name.toLowerCase()}`))
        .find((e) => e !== undefined);
      if (!hit) {
        throw new Error(
          `BEA combination "${label}" (${code}): no catalog county or independent city for "${part}" in state ${state}`,
        );
      }
      out.push({
        ucgid: hit.ucgid,
        agency: "bea",
        program: "GEOFIPS",
        code,
        codeVintage: null,
        note: `BEA publishes ${hit.name} only combined, as "${label}" (${code}).`,
      });
    });
  }
  return out;
}

/** Drops `BEAAPI.Request` — where BEA echoes the caller's key — from a response body (#257). */
export function stripBeaRequest(body: string): string {
  const json = JSON.parse(body) as { BEAAPI?: Record<string, unknown> };
  if (json.BEAAPI) delete json.BEAAPI["Request"];
  return JSON.stringify(json);
}

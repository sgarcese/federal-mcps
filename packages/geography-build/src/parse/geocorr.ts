import { ucgidOf } from "@federal-mcps/core";
import type { ContainmentRow } from "../types.js";

/**
 * Parses a vendored Geocorr export (MCDC Geocorr 2022, 2020-vintage geographies,
 * population-weighted `afact`; see `data/geocorr/README.md`). CSV, one header row.
 *
 * Geocorr's `afact` is the AUTHORITATIVE weighted share where present — it is
 * population-weighted, unlike the Census relationship files' area weighting
 * (`parse/relationship.ts`). `assemble.ts` lets a Geocorr row win over a relationship-file
 * row for the same `(child, parent)` edge.
 *
 * The vendored CSV already carries `child_geoid`/`parent_geoid` in the same anchor
 * convention documented in `relationship.ts` (parent = the crosswalk's anchor geography),
 * so this parser just reads those columns straight through — no per-pair direction
 * decision needed here, only which `geoPair` to filter to.
 */
/**
 * Summary levels for the `child_geoid`/`parent_geoid` columns of each Geocorr `geo_pair`.
 * The pair *name* does not reliably order child-then-parent: Geocorr's export follows the
 * anchor convention (parent = the crosswalk's anchor), and `zcta_tract` anchors on the ZCTA
 * (parent), so its columns are the reverse of `place_county`/`cousub_cbsa`. Hence an explicit
 * per-pair map, keyed to the actual columns, not the name (#73).
 */
const PAIR_LEVELS: Record<string, { child: string; parent: string }> = {
  place_county: { child: "160", parent: "050" }, // child = place, parent = county
  cousub_cbsa: { child: "060", parent: "310" }, // child = county subdivision, parent = CBSA
  zcta_tract: { child: "140", parent: "860" }, // child = tract, parent = ZCTA (the anchor)
};

export function parseGeocorr(text: string, geoPair: string): ContainmentRow[] {
  const levels = PAIR_LEVELS[geoPair];
  // An unrecognized geo_pair matches no rows we can key by UCGID; return nothing, as the
  // old filter-only behavior did (assemble only ever passes the known pairs).
  if (!levels) return [];
  const childLevel = levels.child;
  const parentLevel = levels.parent;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.shift();
  if (!header) return [];
  const cols = parseCsvLine(header).map((c) => c.trim().toLowerCase());
  const idx = (name: string): number => cols.indexOf(name);

  const iPair = idx("geo_pair");
  const iChild = idx("child_geoid");
  const iParent = idx("parent_geoid");
  const iAfact = idx("afact");
  if (iPair < 0 || iChild < 0 || iParent < 0 || iAfact < 0) {
    throw new Error(`geocorr: header lacks expected columns (got ${cols.join(",")})`);
  }

  const out: ContainmentRow[] = [];
  for (const line of lines) {
    const f = parseCsvLine(line);
    if (f[iPair]?.trim() !== geoPair) continue;
    const child = f[iChild]?.trim();
    const parent = f[iParent]?.trim();
    const share = Number(f[iAfact]?.trim());
    if (!child || !parent || !Number.isFinite(share)) continue;
    out.push({
      childUcgid: ucgidOf(childLevel, child),
      parentUcgid: ucgidOf(parentLevel, parent),
      share,
    });
  }
  return out;
}

/** Splits one CSV line, honoring double-quoted fields that may contain commas. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

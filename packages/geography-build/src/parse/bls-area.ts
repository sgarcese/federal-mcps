import type { AgencyCodeRow } from "../types.js";
import { CPI_AREA_TO_CBSA } from "../data/static.js";

/**
 * Decodes a BLS LAUS `la.area` code into the Census GEOID it names and that GEOID's
 * summary level. LAUS codes are 15 chars: a 2-letter type prefix, a 2-digit state FIPS,
 * then the entity code, zero-padded. Only the codes we can map to a Census GEOID are
 * returned; others (SA/PT/ID/BS/RD balance-of-state and part codes) yield null.
 *
 * Examples (verified against la.area):
 *   ST0800000000000 → { geoid: "08",      sumlevel: "040" }  state
 *   CN0803100000000 → { geoid: "08031",   sumlevel: "050" }  county (state+county)
 *   MT0819740000000 → { geoid: "19740",   sumlevel: "310" }  CBSA
 *   DV0631084000000 → { geoid: "31084",   sumlevel: "314" }  metro division
 *   CA0821600000000 → { geoid: "216",     sumlevel: "330" }  CSA (3 significant digits)
 *   CT0820000000000 → { geoid: "0820000", sumlevel: "160" }  place (state+place)
 */
export function decodeLausAreaCode(code: string): { geoid: string; sumlevel: string } | null {
  if (code.length < 4) return null;
  const prefix = code.slice(0, 2);
  const state = code.slice(2, 4);
  const rest = code.slice(4);

  switch (prefix) {
    case "ST":
      return { geoid: state, sumlevel: "040" };
    case "CN":
      return { geoid: state + rest.slice(0, 3), sumlevel: "050" };
    case "CT":
      return { geoid: state + rest.slice(0, 5), sumlevel: "160" };
    case "MT": // metropolitan statistical area
    case "MC": // micropolitan statistical area — both CBSA GEOIDs
      return { geoid: rest.slice(0, 5), sumlevel: "310" };
    case "DV":
      return { geoid: rest.slice(0, 5), sumlevel: "314" };
    case "CA": {
      // CSA: 3 significant digits, left-justified in a 5-wide field then padded.
      const csa = rest.slice(0, 5).replace(/0+$/, "");
      return csa ? { geoid: csa.padStart(3, "0"), sumlevel: "330" } : null;
    }
    default:
      return null; // CS (New England town), SA, PT, ID, IM, BS, RD — not GEOID-mappable here
  }
}

/** `la.area`: tab-delimited `area_type_code, area_code, area_text, ...`. */
export function parseLausArea(text: string): AgencyCodeRow[] {
  return parseBlsAreaFile(text, (areaCode) => {
    const decoded = decodeLausAreaCode(areaCode);
    if (!decoded) return null;
    return {
      geoid: decoded.geoid,
      agency: "bls",
      program: "LAUS",
      code: areaCode,
      codeVintage: 2023,
      note: null,
    };
  });
}

/**
 * CES State & Area `sm.area`: 5-digit area code, `00000` = statewide (skipped — the area
 * file alone carries no state), otherwise a CBSA or metro-division code → CBSA GEOID.
 */
export function parseCesArea(text: string): AgencyCodeRow[] {
  return parseBlsAreaFile(text, (areaCode) => {
    const code = areaCode.trim();
    if (!/^\d{5}$/.test(code) || code === "00000") return null;
    return { geoid: code, agency: "bls", program: "SM", code, codeVintage: 2023, note: null };
  });
}

/**
 * OEWS `oe.area`: a state code column plus a 7-digit area code (CBSA zero-padded to 7,
 * e.g. `0019740`, or a nonmetro area). Metropolitan rows map to the CBSA GEOID.
 */
export function parseOewsArea(text: string): AgencyCodeRow[] {
  return parseBlsAreaFile(text, (areaCode) => {
    const code = areaCode.trim();
    if (!/^\d{7}$/.test(code)) return null;
    const cbsa = code.replace(/^0+/, "");
    if (cbsa.length !== 5) return null; // nonmetro / balance areas — not a CBSA GEOID
    return {
      geoid: cbsa,
      agency: "bls",
      program: "OEWS",
      code,
      codeVintage: 2023,
      note: null,
    };
  });
}

/**
 * CPI `cu.area`: bespoke codes (`S48B`, `S12A`, …) not derivable from FIPS/CBSA. Mapped
 * through a small hand-maintained table to the ~23 published metros' CBSA GEOIDs.
 */
export function parseCpiArea(text: string): AgencyCodeRow[] {
  return parseBlsAreaFile(text, (areaCode) => {
    const code = areaCode.trim();
    const cbsa = CPI_AREA_TO_CBSA[code];
    if (!cbsa) return null;
    return {
      geoid: cbsa,
      agency: "bls",
      program: "CPI",
      code,
      codeVintage: 2013,
      note: "CPI area titles lag the current delineation",
    };
  });
}

/** Shared reader: skip the header, take column 0 (area_code) — well, column depends. */
function parseBlsAreaFile(
  text: string,
  map: (areaCode: string) => AgencyCodeRow | null,
): AgencyCodeRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.shift();
  if (!header) return [];
  const cols = header.split("\t").map((c) => c.trim().toLowerCase());
  const areaIdx = cols.indexOf("area_code");
  const col = areaIdx >= 0 ? areaIdx : 1; // la/sm/oe/cu all name it area_code
  const out: AgencyCodeRow[] = [];
  for (const line of lines) {
    const areaCode = line.split("\t")[col]?.trim();
    if (!areaCode) continue;
    const row = map(areaCode);
    if (row) out.push(row);
  }
  return out;
}

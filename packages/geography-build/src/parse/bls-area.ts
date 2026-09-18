import { ucgidOf } from "@federal-mcps/core";
import type { AgencyCodeRow } from "../types.js";
import { CPI_AREA_TO_CBSA, US_STATE_POSTAL_TO_FIPS } from "../data/static.js";

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
      ucgid: ucgidOf(decoded.sumlevel, decoded.geoid),
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
  return parseBlsAreaFileWithTitle(text, (areaCode, title) => {
    const code = areaCode.trim();
    if (!/^\d{5}$/.test(code) || code === "00000") return null;
    // A CES metro series needs the state (SM · state · area · …); CBSAs are stateless, so read the
    // state from the sm.area title (e.g. "Denver-Aurora-Lakewood, CO"). BLS files a multi-state
    // metro as ONE series under the first state in its title (#153; verified live 2026-09-17:
    // New York-Newark-Jersey City, NY-NJ → SMU36…, Kansas City, MO-KS → SMU29…, Philadelphia
    // PA-NJ-DE-MD → SMU42…, Washington DC-VA-MD-WV → SMU11…; the NJ-prefixed New York id does
    // not exist). Untitled or unparseable rows are skipped — never a fabricated state.
    const parsed = statesFromTitle(title);
    if (!parsed) return null;
    const { first: stateFips, postals } = parsed;
    return {
      ucgid: ucgidOf("310", code),
      agency: "bls",
      program: "SM",
      code: `${stateFips}${code}`, // 7-char state+area, the SM series' geography key
      codeVintage: 2023,
      note:
        postals.length > 1
          ? `CES publishes this multi-state metro as one series under ${postals[0]} (${postals.join("-")}).`
          : null,
    };
  });
}

/**
 * The states a CES area title names ("…, IL-IN-WI"): the first state's FIPS (the one BLS files the
 * series under) and every postal code, or null if any token is unrecognized (an untrusted parse).
 */
function statesFromTitle(title: string): { first: string; postals: string[] } | null {
  const afterComma = title.slice(title.lastIndexOf(",") + 1).trim();
  const postals = (afterComma.split(/\s+/)[0] ?? "").split("-").filter((p) => p.length > 0);
  if (postals.length === 0) return null;
  const fips = postals.map((p) => US_STATE_POSTAL_TO_FIPS[p]);
  const first = fips[0];
  if (!first || fips.some((f) => !f)) return null; // an unrecognized token means we can't trust the parse
  return { first, postals };
}

/**
 * QCEW `area_titles.csv` (`area_fips,area_title`, quoted CSV): metro and micropolitan areas carry a
 * QCEW-specific `C` + 4-digit code that is the CBSA code without its trailing zero (`C1974` ↔ CBSA
 * `19740`; verified 2026-09-17 across all 2,118 C-codes in the file — a fixed pattern, but 252 of
 * them are retired delineations absent from the 2025 gazetteer, which is why the code is read from
 * QCEW's own file rather than derived, ADR-013 §5). CSAs (`CS…`), states, counties and the U.S.
 * total are skipped: the server derives state and county QCEW areas from the GEOID.
 */
export function parseQcewArea(text: string): AgencyCodeRow[] {
  const out: AgencyCodeRow[] = [];
  const seen = new Set<string>();
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(1); // header
  for (const line of lines) {
    const fips =
      line
        .split(",")[0]
        ?.trim()
        .replace(/^"(.*)"$/, "$1") ?? "";
    const m = /^C(\d{4})$/.exec(fips);
    if (!m || seen.has(fips)) continue; // the file repeats ~1,000 area rows verbatim
    seen.add(fips);
    out.push({
      ucgid: ucgidOf("310", `${m[1]}0`),
      agency: "bls",
      program: "QCEW",
      code: fips,
      codeVintage: 2023,
      note: null,
    });
  }
  return out;
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
      ucgid: ucgidOf("310", cbsa),
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
      ucgid: ucgidOf("310", cbsa),
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

/** Like `parseBlsAreaFile`, but also passes the row's title column (`area_text`/`area_name`). */
function parseBlsAreaFileWithTitle(
  text: string,
  map: (areaCode: string, title: string) => AgencyCodeRow | null,
): AgencyCodeRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines.shift();
  if (!header) return [];
  const cols = header.split("\t").map((c) => c.trim().toLowerCase());
  const areaIdx = cols.indexOf("area_code");
  const areaCol = areaIdx >= 0 ? areaIdx : 1;
  const titleIdx =
    cols.indexOf("area_text") >= 0 ? cols.indexOf("area_text") : cols.indexOf("area_name");
  const out: AgencyCodeRow[] = [];
  for (const line of lines) {
    const parts = line.split("\t");
    const areaCode = parts[areaCol]?.trim();
    if (!areaCode) continue;
    const title = (titleIdx >= 0 ? parts[titleIdx] : "")?.trim() ?? "";
    const row = map(areaCode, title);
    if (row) out.push(row);
  }
  return out;
}

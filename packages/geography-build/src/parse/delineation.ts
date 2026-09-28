import { ucgidOf } from "@federal-mcps/core";
import type { ContainmentRow } from "../types.js";

/**
 * OMB's CBSA delineation (#271): which county belongs to which metropolitan or micropolitan
 * statistical area. Census publishes it only as a spreadsheet (`list1_2023.xlsx`); an `.xlsx` is a
 * zip of XML, so the build unzips two members with the system `unzip` it already uses and reads
 * them here — a minimal reader for exactly this file's shape, no spreadsheet dependency.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_m, e: string) => {
    if (e.startsWith("#x") || e.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? `&${e};`;
  });
}

/** `xl/sharedStrings.xml` → the string table; a rich-text entry's runs are joined. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const runs = [...(si[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(
      (t) => t[1] ?? "",
    );
    out.push(decode(runs.join("")));
  }
  return out;
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** `xl/worksheets/sheetN.xml` → rows of cell text, by column letter; empty cells are "". */
export function parseSheetRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of (row[1] ?? "").matchAll(
      /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const col = columnIndex(c[1] ?? "A");
      const attrs = c[2] ?? "";
      const inner = c[3] ?? "";
      let text = "";
      if (/\bt="s"/.test(attrs)) text = shared[Number(/<v>(\d+)<\/v>/.exec(inner)?.[1])] ?? "";
      else if (/\bt="inlineStr"/.test(attrs))
        text = decode(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? "");
      else text = decode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      while (cells.length < col) cells.push("");
      cells[col] = text;
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Delineation rows → county → CBSA `nests` edges (share 1). The header row is the one whose first
 * cell is "CBSA Code"; columns are found by name. Rows without a 5-digit CBSA and a 2-digit state /
 * 3-digit county code (titles, notes) are skipped. Missing the header fails loudly.
 */
export function parseDelineation(rows: readonly (readonly string[])[]): ContainmentRow[] {
  const h = rows.findIndex((r) => r[0]?.trim() === "CBSA Code");
  const header = rows[h];
  if (h < 0 || !header) throw new Error('delineation: no header row starting with "CBSA Code"');
  const col = (name: string) => {
    const i = header.findIndex((cell) => cell.trim() === name);
    if (i < 0) throw new Error(`delineation: header lacks "${name}"`);
    return i;
  };
  const iCbsa = col("CBSA Code");
  const iState = col("FIPS State Code");
  const iCounty = col("FIPS County Code");
  const out: ContainmentRow[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(h + 1)) {
    const cbsa = row[iCbsa]?.trim() ?? "";
    const state = row[iState]?.trim() ?? "";
    const county = row[iCounty]?.trim() ?? "";
    if (!/^\d{5}$/.test(cbsa) || !/^\d{2}$/.test(state) || !/^\d{3}$/.test(county)) continue;
    const key = `${state}${county}>${cbsa}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      childUcgid: ucgidOf("050", `${state}${county}`),
      parentUcgid: ucgidOf("310", cbsa),
      share: 1,
      relation: "nests",
    });
  }
  return out;
}

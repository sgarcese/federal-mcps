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
  return [...elements(xml, "si")].map((si) =>
    decode([...elements(si.inner, "t")].map((t) => t.inner).join("")),
  );
}

/**
 * Each `<tag …>…</tag>` (or self-closing `<tag …/>`) in order, found by linear `indexOf` scanning
 * rather than lazy-match regular expressions, which run in polynomial time on unterminated
 * markup (CodeQL js/polynomial-redos, #332). Same-name nesting does not occur in these parts.
 */
function* elements(xml: string, tag: string): Generator<{ attrs: string; inner: string }> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let from = 0;
  for (;;) {
    const start = xml.indexOf(open, from);
    if (start === -1) return;
    const next = xml.charAt(start + open.length);
    if (next !== ">" && next !== "/" && next.trim() !== "") {
      from = start + open.length; // a longer tag name (`<tab` for `<t`)
      continue;
    }
    const gt = xml.indexOf(">", start);
    if (gt === -1) return;
    if (xml.charAt(gt - 1) === "/") {
      yield { attrs: xml.slice(start + open.length, gt - 1), inner: "" };
      from = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt);
    if (end === -1) return;
    yield { attrs: xml.slice(start + open.length, gt), inner: xml.slice(gt + 1, end) };
    from = end + close.length;
  }
}

/** One attribute's value from an element's attribute text, or undefined. */
function attribute(attrs: string, name: string): string | undefined {
  const key = ` ${name}="`;
  const at = ` ${attrs}`.indexOf(key);
  if (at === -1) return undefined;
  const begin = at + key.length - 1;
  const stop = attrs.indexOf('"', begin);
  return stop === -1 ? undefined : attrs.slice(begin, stop);
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** `xl/worksheets/sheetN.xml` → rows of cell text, by column letter; empty cells are "". */
export function parseSheetRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const row of elements(xml, "row")) {
    const cells: string[] = [];
    for (const c of elements(row.inner, "c")) {
      const ref = attribute(c.attrs, "r") ?? "A";
      let letters = "";
      for (const ch of ref) {
        if (ch < "A" || ch > "Z") break;
        letters += ch;
      }
      const col = columnIndex(letters || "A");
      const type = attribute(c.attrs, "t");
      const first = (tag: string) => elements(c.inner, tag).next().value?.inner;
      let text = "";
      if (type === "s") {
        const v = first("v") ?? "";
        text = /^\d+$/.test(v) ? (shared[Number(v)] ?? "") : "";
      } else if (type === "inlineStr") text = decode(first("t") ?? "");
      else text = decode(first("v") ?? "");
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

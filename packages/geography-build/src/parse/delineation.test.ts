import { ucgidOf } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { parseDelineation, parseSharedStrings, parseSheetRows } from "./delineation.js";

/** The shape of OMB's list1_2023.xlsx (verified 2026-09-28): a title row, the header in row 3. */
const SHARED = `<?xml version="1.0" encoding="UTF-8"?><sst count="9" uniqueCount="9">
<si><t>Table with row headers in column A and column headers in row 3</t></si>
<si><t>CBSA Code</t></si><si><t>Metropolitan/Micropolitan Statistical Area</t></si>
<si><t>FIPS State Code</t></si><si><t>FIPS County Code</t></si>
<si><t>43780</t></si><si><t>Metropolitan Statistical Area</t></si><si><t>18</t></si><si><t>141</t></si>
<si><r><t>Note: </t></r><r><t>Kalawao &amp; Maui</t></r></si>
<si><t>38500</t></si><si><t>Micropolitan Statistical Area</t></si><si><t>099</t></si>
</sst>`;
const c = (ref: string, s: number) => `<c r="${ref}" s="6" t="s"><v>${s}</v></c>`;
const SHEET = `<worksheet><sheetData>
<row r="1">${c("A1", 0)}</row>
<row r="3">${c("A3", 1)}${c("B3", 2)}<c r="C3" s="2"/>${c("D3", 3)}${c("E3", 4)}</row>
<row r="4">${c("A4", 5)}${c("B4", 6)}<c r="C4" s="6"/>${c("D4", 7)}${c("E4", 8)}</row>
<row r="5">${c("A5", 10)}${c("B5", 11)}<c r="C5" s="6"/>${c("D5", 7)}${c("E5", 12)}</row>
<row r="9">${c("A9", 9)}</row>
</sheetData></worksheet>`;

describe("the minimal xlsx reader (#271)", () => {
  it("reads shared strings, joining rich-text runs and decoding entities", () => {
    const strings = parseSharedStrings(SHARED);
    expect(strings[1]).toBe("CBSA Code");
    expect(strings[9]).toBe("Note: Kalawao & Maui");
  });

  it("reads rows by column letter, empty cells as empty strings", () => {
    const rows = parseSheetRows(SHEET, parseSharedStrings(SHARED));
    const header = rows.find((r) => r[0] === "CBSA Code");
    expect(header).toEqual([
      "CBSA Code",
      "Metropolitan/Micropolitan Statistical Area",
      "",
      "FIPS State Code",
      "FIPS County Code",
    ]);
  });
});

describe("parseDelineation (#271)", () => {
  const edges = parseDelineation(parseSheetRows(SHEET, parseSharedStrings(SHARED)));

  it("nests each county in its CBSA, metropolitan and micropolitan alike", () => {
    expect(edges).toEqual([
      {
        childUcgid: ucgidOf("050", "18141"),
        parentUcgid: ucgidOf("310", "43780"),
        share: 1,
        relation: "nests",
      },
      {
        childUcgid: ucgidOf("050", "18099"),
        parentUcgid: ucgidOf("310", "38500"),
        share: 1,
        relation: "nests",
      },
    ]);
  });

  it("fails loudly when the header row is missing — never an empty result that looks like data", () => {
    expect(() => parseDelineation([["something else"]])).toThrow(/CBSA Code/);
  });
});

import { ucgidOf } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import {
  decodeLausAreaCode,
  parseCesArea,
  parseCpiArea,
  parseLausArea,
  parseOewsArea,
  parseQcewArea,
} from "./bls-area.js";

describe("decodeLausAreaCode", () => {
  it.each([
    ["ST0800000000000", "08", "040"],
    ["CN0803100000000", "08031", "050"],
    ["CT0820000000000", "0820000", "160"],
    ["MT0819740000000", "19740", "310"],
    ["DV0631084000000", "31084", "314"],
    ["CA0821600000000", "216", "330"],
  ])("%s → %s (%s)", (code, geoid, sumlevel) => {
    expect(decodeLausAreaCode(code)).toEqual({ geoid, sumlevel });
  });

  it("returns null for balance-of-state and part codes it cannot map", () => {
    expect(decodeLausAreaCode("BS0800000000000")).toBeNull();
    expect(decodeLausAreaCode("PT0812345000000")).toBeNull();
    expect(decodeLausAreaCode("CS2500000000000")).toBeNull();
  });
});

const LA_AREA = [
  "area_type_code\tarea_code\tarea_text\tdisplay_level\tselectable\tsort_sequence",
  "A\tST0800000000000\tColorado\t0\tT\t1",
  "F\tCN0803100000000\tDenver County, CO\t2\tT\t2",
  "B\tMT0819740000000\tDenver-Aurora-Lakewood, CO Met\t1\tT\t3",
  "L\tBS0800000000000\tBalance of Colorado\t1\tT\t4",
].join("\n");

describe("parseLausArea", () => {
  it("maps mappable areas to agency codes and skips the rest", () => {
    const rows = parseLausArea(LA_AREA);
    expect(rows.map((r) => r.ucgid).sort()).toEqual(
      [ucgidOf("040", "08"), ucgidOf("050", "08031"), ucgidOf("310", "19740")].sort(),
    );
    expect(rows.every((r) => r.agency === "bls" && r.program === "LAUS")).toBe(true);
    const metro = rows.find((r) => r.ucgid === ucgidOf("310", "19740"));
    expect(metro?.code).toBe("MT0819740000000");
  });
});

describe("parseCesArea / parseOewsArea / parseCpiArea", () => {
  it("CES emits a state+area code for a single-state metro and skips statewide", () => {
    const sm = [
      "area_code\tarea_name",
      "19740\tDenver-Aurora-Lakewood, CO",
      "00000\tStatewide",
    ].join("\n");
    const rows = parseCesArea(sm);
    expect(rows.map((r) => r.ucgid)).toEqual([ucgidOf("310", "19740")]);
    expect(rows[0]?.code).toBe("0819740"); // state 08 + area 19740, the SM series key
    expect(rows[0]?.note).toBeNull();
  });

  it("CES files a multi-state metro under the FIRST state in its title, with a note (#153)", () => {
    // Verified live 2026-09-17: SMU36356200000000001 (NY-NJ), SMU29281400000000001 (MO-KS),
    // SMU42379800000000001 (PA-NJ-DE-MD), SMU11479000000000001 (DC-VA-MD-WV) all exist;
    // SMU34356200000000001 (the NJ prefix for New York) does not.
    const sm = [
      "area_code\tarea_name",
      "16980\tChicago-Naperville-Elgin, IL-IN-WI",
      "35620\tNew York-Newark-Jersey City, NY-NJ",
      "47900\tWashington-Arlington-Alexandria, DC-VA-MD-WV",
    ].join("\n");
    const rows = parseCesArea(sm);
    expect(rows.map((r) => r.code)).toEqual(["1716980", "3635620", "1147900"]);
    expect(rows[0]?.note).toMatch(/multi-state.*IL/);
  });

  it("QCEW maps a metro C-code from area_titles.csv to its CBSA; skips CSAs, states, counties, US (#153)", () => {
    const csv = [
      '"area_fips","area_title"',
      '"US000","U.S. TOTAL"',
      '"08000","Colorado -- Statewide"',
      '"08031","Denver County, Colorado"',
      '"C1974","Denver-Aurora-Centennial, CO MSA"',
      '"C1002","Abbeville, LA MicroSA"',
      '"C1974","Denver-Aurora-Centennial, CO MSA"', // the file repeats rows verbatim
      '"CS216","Denver-Aurora-Greeley, CO CSA"',
    ].join("\n");
    const rows = parseQcewArea(csv);
    expect(rows).toEqual([
      expect.objectContaining({ ucgid: ucgidOf("310", "19740"), program: "QCEW", code: "C1974" }),
      expect.objectContaining({ ucgid: ucgidOf("310", "10020"), program: "QCEW", code: "C1002" }),
    ]);
  });

  it("OEWS maps a 7-digit zero-padded CBSA", () => {
    const oe = ["area_code\tarea_name", "0019740\tDenver", "0100001\tNW nonmetro"].join("\n");
    expect(parseOewsArea(oe).map((r) => r.ucgid)).toEqual([ucgidOf("310", "19740")]);
  });

  it("CPI maps a bespoke area code through the hand table", () => {
    const cu = ["area_code\tarea_name", "S48B\tDenver", "0000\tUS city average"].join("\n");
    const rows = parseCpiArea(cu);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ucgid: ucgidOf("310", "19740"), program: "CPI" });
  });
});

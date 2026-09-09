import { describe, expect, it } from "vitest";
import { assemble } from "./assemble.js";

const STATES = [
  "USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
  "CO\t08\t01779779\tColorado\t1\t1\t39\t-105",
].join("\n");
const COUNTIES = [
  "USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
  "CO\t08031\t00198131\tDenver County\t1\t1\t39\t-104",
].join("\n");
const PLACES = [
  "USPS\tGEOID\tANSICODE\tNAME\tLSAD\tFUNCSTAT\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
  "CO\t0820000\t02412049\tDenver city\t25\tF\t1\t1\t39\t-104",
].join("\n");
const LA_AREA = [
  "area_type_code\tarea_code\tarea_text\tdisplay_level\tselectable\tsort_sequence",
  "A\tST0800000000000\tColorado\t0\tT\t1",
  "F\tCN0803100000000\tDenver County, CO\t2\tT\t2",
].join("\n");

describe("assemble", () => {
  const rows = assemble({
    gazetteers: { "040": STATES, "050": COUNTIES, "160": PLACES },
    lausArea: LA_AREA,
  });

  it("collects entities and aliases across gazetteer files", () => {
    expect(rows.entities.map((e) => e.geoid).sort()).toEqual(["08", "08031", "0820000"]);
    expect(rows.aliases).toContainEqual({
      geoid: "08031",
      alias: "Denver",
      source: "lsad-stripped",
    });
  });

  it("derives strict geoid nesting (county→state, place→state) only for present parents", () => {
    expect(rows.containment).toContainEqual({ childGeoid: "08031", parentGeoid: "08", share: 1 });
    expect(rows.containment).toContainEqual({ childGeoid: "0820000", parentGeoid: "08", share: 1 });
    // No place→county here (that is weighted containment, #55).
    expect(
      rows.containment.some((c) => c.childGeoid === "0820000" && c.parentGeoid === "08031"),
    ).toBe(false);
  });

  it("loads BLS agency codes and the static publishes_at / county_change tables", () => {
    expect(rows.agencyCodes.map((a) => a.geoid).sort()).toEqual(["08", "08031"]);
    expect(rows.publishesAt.some((p) => p.program === "LAUS" && p.sumlevel === "160")).toBe(true);
    expect(rows.countyChange.some((c) => c.oldGeoid === "09001")).toBe(true);
    expect(rows.lineage).toEqual([]); // #55
  });
});

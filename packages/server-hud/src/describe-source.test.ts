import { describe, expect, it } from "vitest";
import {
  HUD_USER_API_ENDPOINT,
  HUD_USER_REQUIRED_SENTENCE,
  describeSource,
} from "./describe-source.js";

describe("HUD describeSource()", () => {
  it("names the agency and homepage", () => {
    const d = describeSource();
    expect(d.agency).toBe("hud");
    expect(d.agencyName).toContain("HUD User");
    expect(d.homepage).toBe("https://www.huduser.gov");
    expect(HUD_USER_API_ENDPOINT).toBe("https://www.huduser.gov/hudapi/public");
  });

  it("lists FMR, IL, CHAS and PICTURE, all available now the indicator tools ship (#237)", () => {
    const d = describeSource();
    const byCode = Object.fromEntries(d.programs.map((p) => [p.code, p]));
    for (const code of ["FMR", "IL", "CHAS", "PICTURE"]) {
      expect(byCode[code]?.status).toBe("available");
      expect(byCode[code]?.granularity.length).toBeGreaterThan(0);
    }
    expect(byCode.FMR?.granularity).toContain("ZIP");
    expect(byCode.CHAS?.name).toContain("Comprehensive Housing Affordability Strategy");
  });

  it("no longer calls itself a shell, and names the New England town gap (#241)", () => {
    const caveats = describeSource().caveats.join(" ");
    expect(caveats).not.toMatch(/shell only|planned, not yet queryable/);
    expect(caveats).toMatch(/New England/);
    expect(caveats).toContain("hud_get_raw");
  });

  it("states that a token is required, the 60/minute rate, and carries the required HUD User sentence", () => {
    const d = describeSource();
    expect(d.quota).toContain("token");
    expect(d.quota).toContain("60");
    expect(d.caveats.join(" ")).toContain(HUD_USER_REQUIRED_SENTENCE);
  });
});

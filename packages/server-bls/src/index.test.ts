import { describe, expect, it } from "vitest";
import { AGENCY, describeBuild } from "./index.js";

describe("@federal-mcps/server-bls workspace wiring", () => {
  it("resolves @federal-mcps/core through the workspace", () => {
    expect(describeBuild()).toEqual({ agency: "bls", coreVersion: expect.any(String) });
  });

  it("uses the agency prefix every BLS tool name will carry", () => {
    expect(AGENCY).toBe("bls");
  });
});

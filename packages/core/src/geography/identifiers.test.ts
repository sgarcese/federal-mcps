import { describe, expect, it } from "vitest";
import { dcidOf, ucgidOf } from "./identifiers.js";

describe("ucgidOf", () => {
  it("encodes the summary level so colliding GEOIDs get distinct ids (#73)", () => {
    expect(ucgidOf("050", "06075")).toBe("0500000US06075"); // San Francisco County
    expect(ucgidOf("860", "06075")).toBe("8600000US06075"); // ZCTA 06075
    expect(ucgidOf("050", "06075")).not.toBe(ucgidOf("860", "06075"));
  });
});

describe("dcidOf", () => {
  it("prefixes a CBSA's DCID with C, others plain", () => {
    expect(dcidOf("050", "08031")).toBe("geoId/08031");
    expect(dcidOf("310", "19740")).toBe("geoId/C19740");
  });
});

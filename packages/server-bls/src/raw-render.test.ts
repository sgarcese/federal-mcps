import { describe, expect, it } from "vitest";
import { renderBlsRaw } from "./raw-render.js";

/** A BLS Public Data API v2 response, as `bls_get_raw` returns it in `data.responses` (#210). */
const response = {
  status: "REQUEST_SUCCEEDED",
  message: ["No Data Available for Series LNU04000000 Year: 2015"],
  Results: {
    series: [
      {
        seriesID: "CEU2000000003",
        data: [
          {
            year: "2026",
            period: "M08",
            periodName: "August",
            value: "38.12",
            footnotes: [{ code: "P", text: "preliminary" }],
          },
          { year: "2026", period: "M07", periodName: "July", value: "38.05", footnotes: [{}] },
        ],
      },
      {
        seriesID: "LNU04000000",
        data: [{ year: "2026", period: "M08", periodName: "August", value: "4.2", footnotes: [] }],
      },
    ],
  },
};

describe("renderBlsRaw (#210, ADR-017)", () => {
  it("renders one block per series: an id line, then year,period,value,footnotes lines", () => {
    const r = renderBlsRaw({ ids: ["CEU2000000003", "LNU04000000"], responses: [response] });
    expect(r?.unit).toBe("series");
    expect(r?.items).toEqual([
      "series CEU2000000003 (2 observations)\n2026,M08,38.12,P\n2026,M07,38.05,",
      "series LNU04000000 (1 observation)\n2026,M08,4.2,",
    ]);
  });

  it("puts the column header and the API's messages in the head, once", () => {
    const r = renderBlsRaw({ ids: ["CEU2000000003"], responses: [response] });
    expect(r?.head).toEqual([
      "columns: year,period,value,footnotes",
      "note: No Data Available for Series LNU04000000 Year: 2015",
    ]);
    expect(r?.narrowHint).toMatch(/fewer ids|shorter/);
  });

  it("collects series across the batched responses (the API takes 50 ids per request)", () => {
    const r = renderBlsRaw({ ids: ["A", "B"], responses: [response, response] });
    expect(r?.items).toHaveLength(4);
  });

  it("declines (undefined) when the data is not a BLS response, so the JSON rendering is used", () => {
    expect(renderBlsRaw({ nope: true })).toBeUndefined();
  });
});

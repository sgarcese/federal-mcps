import {
  AgencyApiError,
  createHttpClient,
  type HttpClient,
  MemoryBudgetStore,
  MemoryCacheStore,
} from "@federal-mcps/core";
import { describe, expect, it, vi } from "vitest";
import {
  BEA_PER_MINUTE,
  beaBodyError,
  beaDataUrl,
  beaGetData,
  beaObservation,
  sanitizeBeaBody,
  unitOf,
  vintageNote,
} from "./bea-api.js";

/** Shapes verified live 2026-09-28 (docs/spikes/m14-bea-regional.md); the key is a stand-in. */
const KEY = "00000000-1111-2222-3333-444444444444";
const envelope = (results: unknown) =>
  JSON.stringify({
    BEAAPI: {
      Request: {
        RequestParam: [
          { ParameterName: "USERID", ParameterValue: KEY },
          { ParameterName: "METHOD", ParameterValue: "GETDATA" },
        ],
      },
      Results: results,
    },
  });
const ST_JOSEPH_2024 = {
  Code: "CAINC1-3",
  GeoFips: "18141",
  GeoName: "St. Joseph",
  TimePeriod: "2024",
  CL_UNIT: "Dollars",
  UNIT_MULT: "0",
  DataValue: "59030",
  NoteRef: "2",
};
const LOVING_D = {
  Code: "CAGDP2-11",
  GeoFips: "48301",
  GeoName: "Loving",
  TimePeriod: "2023",
  CL_UNIT: "Thousands of dollars",
  UNIT_MULT: "3",
  DataValue: "0",
  NoteRef: "(D)",
};
const NOTES = [
  {
    NoteRef: "(D)",
    NoteText:
      "Not shown to avoid disclosure of confidential information; estimates are included in higher-level totals.",
  },
  {
    NoteRef: " ",
    NoteText:
      "Last updated: February 5, 2026-- new statistics for 2024; revised statistics for 2020-2023.",
  },
];

describe("sanitizeBeaBody: BEA's echo of the key never survives (ADR-019 §3)", () => {
  it("drops BEAAPI.Request and keeps the results", () => {
    const out = sanitizeBeaBody(envelope({ Data: [ST_JOSEPH_2024] }));
    expect(out).not.toContain(KEY);
    expect(JSON.parse(out).BEAAPI.Results.Data).toHaveLength(1);
  });

  it("passes a non-JSON body through unchanged", () => {
    expect(sanitizeBeaBody("<html>")).toBe("<html>");
  });
});

describe("beaBodyError: errors BEA answers with HTTP 200 (ADR-019 §4)", () => {
  it("reads APIErrorCode and the detail; parameter errors are not retryable", () => {
    const err = beaBodyError(
      envelope({
        Error: {
          APIErrorCode: "40",
          APIErrorDescription:
            "The dataset requested requires parameters that were missing from the request.",
          ErrorDetail: { Description: "Invalid Value for Parameter TableName" },
        },
      }),
    );
    expect(err).toEqual({
      code: "40",
      message: "Invalid Value for Parameter TableName",
      retryable: false,
    });
    expect(
      beaBodyError(
        envelope({ Error: { APIErrorCode: "101", APIErrorDescription: "Unknown error." } }),
      )?.retryable,
    ).toBe(false);
    expect(
      beaBodyError(
        envelope({
          Error: { APIErrorCode: "4", APIErrorDescription: "This UserId is not active." },
        }),
      )?.retryable,
    ).toBe(false);
  });

  it("the quota error (7) is retryable; a data body is no error", () => {
    expect(
      beaBodyError(
        envelope({
          Error: { APIErrorCode: "7", APIErrorDescription: "exceeded Requests per minute quota." },
        }),
      )?.retryable,
    ).toBe(true);
    expect(beaBodyError(envelope({ Data: [] }))).toBeUndefined();
  });
});

describe("beaDataUrl: a fixed parameter order, key-less", () => {
  it("builds GetData for one place and a year list", () => {
    expect(
      beaDataUrl({ table: "CAINC1", lineCode: 3, geoFips: "18141", year: ["2021", "2022"] }),
    ).toBe(
      "https://apps.bea.gov/api/data?method=GetData&datasetname=Regional&TableName=CAINC1&LineCode=3&GeoFips=18141&Year=2021,2022&ResultFormat=JSON",
    );
  });

  it("joins several places into one GeoFips list (compare in one call) and passes special values", () => {
    expect(
      beaDataUrl({ table: "MARPP", lineCode: 1, geoFips: ["43780", "19740"], year: "LAST5" }),
    ).toBe(
      "https://apps.bea.gov/api/data?method=GetData&datasetname=Regional&TableName=MARPP&LineCode=1&GeoFips=43780,19740&Year=LAST5&ResultFormat=JSON",
    );
    expect(beaDataUrl({ table: "CAINC1", lineCode: 1, geoFips: "COUNTY" })).not.toContain("Year=");
  });
});

describe("beaGetData: the key as queryAuth, through a client with BEA's hooks", () => {
  const fakeFetch = (body: string) => vi.fn(async () => new Response(body, { status: 200 }));
  const client = (fetchFn: ReturnType<typeof fakeFetch>) =>
    createHttpClient({
      source: "bea",
      budget: new MemoryBudgetStore(100),
      cache: new MemoryCacheStore(),
      fetch: fetchFn as unknown as typeof fetch,
      fixtures: { mode: "off" },
      perMinute: BEA_PER_MINUTE,
      sanitize: sanitizeBeaBody,
      bodyError: beaBodyError,
    });

  it("sends UserID only on the wire and returns the results without the echo", async () => {
    const fetchFn = fakeFetch(envelope({ Data: [ST_JOSEPH_2024], Notes: NOTES }));
    const results = await beaGetData(
      client(fetchFn),
      { table: "CAINC1", lineCode: 3, geoFips: "18141", year: "2024" },
      KEY,
    );
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain(`UserID=${KEY}`);
    expect(results.Data?.[0]?.DataValue).toBe("59030");
    expect(JSON.stringify(results)).not.toContain(KEY);
  });

  it("a BEA error becomes AgencyApiError, fetched once", async () => {
    const fetchFn = fakeFetch(
      envelope({ Error: { APIErrorCode: "40", APIErrorDescription: "bad" } }),
    );
    await expect(
      beaGetData(client(fetchFn), { table: "NOPE1", lineCode: 1, geoFips: "18141" }, KEY),
    ).rejects.toBeInstanceOf(AgencyApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses without a key, naming BEA_API_KEY", async () => {
    await expect(
      beaGetData({} as HttpClient, { table: "CAINC1", lineCode: 1, geoFips: "18141" }, undefined),
    ).rejects.toThrow(/BEA_API_KEY/);
  });
});

describe("beaObservation: sentinels are never numbers (ADR-019 §5)", () => {
  it("an annual value", () => {
    expect(beaObservation(ST_JOSEPH_2024, NOTES)).toEqual({
      year: "2024",
      period: "A01",
      periodName: "2024",
      value: 59030,
      footnotes: [],
    });
  });

  it("a (D) cell is null with BEA's disclosure note, never 0", () => {
    const obs = beaObservation(LOVING_D, NOTES);
    expect(obs.value).toBeNull();
    expect(obs.footnotes).toEqual([{ code: "(D)", text: NOTES[0]?.NoteText }]);
  });

  it("an (NA) cell alongside a geography note is null, and the marker is read out of a combined NoteRef", () => {
    const obs = beaObservation({ ...ST_JOSEPH_2024, DataValue: "0", NoteRef: "(NA) *" }, []);
    expect(obs.value).toBeNull();
    expect(obs.footnotes[0]?.code).toBe("(NA)");
  });

  it("a quarter", () => {
    expect(
      beaObservation({ ...ST_JOSEPH_2024, TimePeriod: "2026Q1", DataValue: "67272" }),
    ).toMatchObject({ year: "2026", period: "Q01", periodName: "2026 Q1", value: 67272 });
  });
});

describe("unitOf and vintageNote", () => {
  it("the row's unit wins over the table's", () => {
    expect(unitOf(ST_JOSEPH_2024, { UnitOfMeasure: "Thousands of dollars" })).toBe("Dollars");
  });

  it("the release note travels as BEA states it", () => {
    expect(vintageNote({ Notes: NOTES })).toBe(
      "BEA: Last updated: February 5, 2026-- new statistics for 2024; revised statistics for 2020-2023.",
    );
    expect(vintageNote({ Notes: [] })).toBeUndefined();
  });
});

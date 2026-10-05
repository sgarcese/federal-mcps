import type { HttpClient, RequestOptions } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { acsFetch, buildAcsSeriesKey } from "./acs.js";
import { buildDecennialSeriesKey, decennialFetch } from "./decennial.js";
import { censusGetRawTool } from "./get-raw.js";

/**
 * Stale windows (#323): a cached answer may be served after its fresh window when a refresh is
 * refused or fails, so every request carries a stale window longer than its fresh one. Without
 * it, the core client's stale window equals the fresh TTL and stale is never served.
 */
function recordingClient(calls: (RequestOptions | undefined)[]): HttpClient {
  const stop = (options?: RequestOptions): never => {
    calls.push(options);
    throw new Error("recorded");
  };
  return {
    getJson: async (_url, options) => stop(options),
    getText: async (_url, options) => stop(options),
    postJson: async (_url, _body, options) => stop(options),
  };
}

function expectLongerStale(calls: (RequestOptions | undefined)[]): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const options of calls) {
    expect(options?.freshTtlSeconds).toBeGreaterThan(0);
    expect(options?.staleTtlSeconds).toBeGreaterThan(options?.freshTtlSeconds ?? Infinity);
  }
}

const UCGID = "0500000US08031";

describe("Census stale windows", () => {
  it("ACS requests carry a stale window longer than the fresh one", async () => {
    const calls: (RequestOptions | undefined)[] = [];
    const key = buildAcsSeriesKey({
      vintage: "2024",
      product: "5-year",
      family: "detailed",
      variable: "B19013_001",
      ucgid: UCGID,
    });
    await acsFetch(recordingClient(calls), [key], {}).catch(() => undefined);
    expectLongerStale(calls);
  });

  it("decennial requests carry a stale window longer than the fresh one", async () => {
    const calls: (RequestOptions | undefined)[] = [];
    await decennialFetch(recordingClient(calls), [buildDecennialSeriesKey(UCGID)], {}).catch(
      () => undefined,
    );
    expectLongerStale(calls);
  });

  it("census_get_raw requests carry a stale window longer than the fresh one", async () => {
    const calls: (RequestOptions | undefined)[] = [];
    const client = recordingClient(calls);
    const tool = censusGetRawTool({ httpClient: () => client });
    await tool.handler(tool.examples[0].input, { now: () => new Date() }).catch(() => undefined);
    expectLongerStale(calls);
  });
});

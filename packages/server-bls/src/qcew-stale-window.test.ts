import type { HttpClient, RequestOptions } from "@federal-mcps/core";
import { expect, it } from "vitest";
import { qcewIndicatorDefinitions } from "./qcew-indicators.js";

/**
 * Stale window (#323): a cached QCEW slice may be served after its fresh window when a refresh is
 * refused or fails, so every slice request carries a stale window longer than its fresh one.
 * (BLS timeseries have theirs since #325.)
 */
it("QCEW slice requests carry a stale window longer than the fresh one", async () => {
  const calls: (RequestOptions | undefined)[] = [];
  const client: HttpClient = {
    getJson: async () => {
      throw new Error("unused");
    },
    getText: async (_url, options) => {
      calls.push(options);
      return { value: "", status: 200, cache: { hit: false } };
    },
    postJson: async () => {
      throw new Error("unused");
    },
  };
  const fetch = qcewIndicatorDefinitions.find((d) => d.name === "covered_employment")?.fetch;
  if (!fetch) throw new Error("no QCEW fetch");
  await fetch(client, ["08031|0|10"], {});
  expect(calls.length).toBeGreaterThan(0);
  for (const options of calls) {
    expect(options?.staleTtlSeconds).toBeGreaterThan(options?.freshTtlSeconds ?? Infinity);
  }
});

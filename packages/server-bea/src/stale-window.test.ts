import type { HttpClient, RequestOptions } from "@federal-mcps/core";
import { expect, it } from "vitest";
import { beaGetData } from "./bea-api.js";

/**
 * Stale window (#323): a cached BEA answer may be served after its fresh window when a refresh is
 * refused or fails, so every request carries a stale window longer than its fresh one.
 */
it("BEA requests carry a stale window longer than the fresh one", async () => {
  const calls: (RequestOptions | undefined)[] = [];
  const client: HttpClient = {
    getJson: async (_url, options) => {
      calls.push(options);
      throw new Error("recorded");
    },
    getText: async () => {
      throw new Error("unused");
    },
    postJson: async () => {
      throw new Error("unused");
    },
  };
  await beaGetData(client, { table: "CAINC1", lineCode: 3, geoFips: "08031" }, "key").catch(
    () => undefined,
  );
  expect(calls).toHaveLength(1);
  const [options] = calls;
  expect(options?.staleTtlSeconds).toBeGreaterThan(options?.freshTtlSeconds ?? Infinity);
});

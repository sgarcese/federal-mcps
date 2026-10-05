import type { HttpClient, RequestOptions } from "@federal-mcps/core";
import { expect, it } from "vitest";
import { hudGetJson } from "./hud-api.js";

/**
 * Stale window (#323): a cached HUD answer may be served after its fresh window when a refresh is
 * refused or fails, so every request carries a stale window longer than its fresh one.
 */
it("HUD requests carry a stale window longer than the fresh one", async () => {
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
  await hudGetJson(
    client,
    "https://www.huduser.gov/hudapi/public/fmr/data/0803199999",
    () => "t",
  ).catch(() => undefined);
  expect(calls).toHaveLength(1);
  const [options] = calls;
  expect(options?.staleTtlSeconds).toBeGreaterThan(options?.freshTtlSeconds ?? Infinity);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Caller } from "../server/caller.js";
import { LIMITS_ENV } from "./config.js";
import { DynamoCounterStore } from "./dynamo-store.js";
import { LIMITS_TABLE_ENV, limiterFromEnv } from "./from-env.js";
import { LimitExceededError, NO_LIMITER } from "./limiter.js";

/**
 * Each server builds its limiter once per container from the environment (#322, ADR-020 §7):
 * `FEDERAL_MCPS_LIMITS` plus a table name means DynamoDB; the config without a table means an
 * in-memory store (with one warning); no config means no limiter.
 */

const AT = new Date("2026-10-05T12:00:00.000Z");
const CALLER: Caller = { key: "k", kind: "network", labels: {}, bypass: false };
const CONFIG = JSON.stringify({ network: { toolCallsDaily: 1 } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("limiterFromEnv", () => {
  it("is NO_LIMITER without FEDERAL_MCPS_LIMITS", () => {
    expect(limiterFromEnv({})).toBe(NO_LIMITER);
    expect(limiterFromEnv({ [LIMITS_TABLE_ENV]: "rc-federal-mcps-dev-limits" })).toBe(NO_LIMITER);
  });

  it("uses the DynamoDB store when the config and a table are both set", () => {
    const stores: unknown[] = [];
    limiterFromEnv(
      { [LIMITS_ENV]: CONFIG, [LIMITS_TABLE_ENV]: "rc-federal-mcps-dev-limits" },
      { onStore: (store) => stores.push(store) },
    );
    expect(stores[0]).toBeInstanceOf(DynamoCounterStore);
  });

  it("falls back to an in-memory store, warning once, when the table is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limiter = limiterFromEnv({ [LIMITS_ENV]: CONFIG });
    limiterFromEnv({ [LIMITS_ENV]: CONFIG });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(LIMITS_TABLE_ENV);
    await limiter.beginToolCall(CALLER, AT);
    await expect(limiter.beginToolCall(CALLER, AT)).rejects.toBeInstanceOf(LimitExceededError);
  });

  it("throws on a malformed config, so a bad deploy fails at cold start", () => {
    expect(() => limiterFromEnv({ [LIMITS_ENV]: "{" })).toThrow(LIMITS_ENV);
  });
});

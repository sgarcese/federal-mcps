import { describe, expect, it, vi } from "vitest";
import { currentCall, runInCall } from "../limits/context.js";
import { LimitExceededError } from "../limits/limiter.js";
import { type BudgetStore, MemoryBudgetStore } from "./budget.js";
import { MemoryCacheStore } from "./cache-store.js";
import { createHttpClient } from "./client.js";
import { QuotaExceededError } from "./errors.js";

/**
 * Stale first (ADR-020 §4, #323): when an upstream query is refused by a share or the service
 * budget and the cache holds the answer within its stale window, the client serves the cached
 * value instead of the refusal, and says why in a note the shell adds to the answer's limitations.
 */
const URL = "https://api.bls.gov/x";
const STORED = new Date("2026-10-05T00:00:00.000Z");
const LATER = new Date("2026-10-05T06:00:00.000Z"); // 6h: past fresh (1h), within stale (7d)
const TTL = { freshTtlSeconds: 3600, staleTtlSeconds: 7 * 86_400 };
const RESET = "2026-10-06T00:00:00.000Z";

/** A budget that allows the first query (to fill the cache), then refuses with `refusal`. */
function refusingAfterOne(refusal: () => Error): BudgetStore {
  let calls = 0;
  return {
    consume: async () => {
      calls += 1;
      if (calls > 1) throw refusal();
      return { allowed: true, remaining: 1, resetsAt: RESET };
    },
  };
}

async function primedClient(budget: BudgetStore) {
  let now = STORED;
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ n: 1 }), { status: 200 }));
  const client = createHttpClient({
    source: "bls",
    budget,
    cache: new MemoryCacheStore(),
    fetch: fetchFn,
    fixtures: { mode: "off" },
    now: () => now,
  });
  await client.getJson(URL, TTL);
  now = LATER;
  return { client, fetchFn };
}

async function inCall<T>(fn: () => Promise<T>): Promise<{ result: T; notes: string[] }> {
  return runInCall({}, async () => {
    const result = await fn();
    return { result, notes: [...(currentCall()?.notes ?? [])] };
  });
}

describe("stale first", () => {
  it("serves an aged entry instead of a share refusal, with a note naming the share and reset", async () => {
    const { client, fetchFn } = await primedClient(
      refusingAfterOne(
        () =>
          new LimitExceededError({
            scope: "network",
            kind: "upstream",
            source: "bls",
            limit: 100,
            used: 100,
            resetsAt: RESET,
          }),
      ),
    );
    const { result, notes } = await inCall(() => client.getJson<{ n: number }>(URL, TTL));
    expect(result.value).toEqual({ n: 1 });
    expect(result.cache).toEqual({ hit: true, ageSeconds: 6 * 3600, stale: true });
    expect(notes).toEqual([
      `Served from cache (retrieved ${STORED.toISOString()}): today's network share for bls is spent; resets ${RESET}.`,
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("serves an aged entry instead of the service budget's QuotaExceededError", async () => {
    const { client } = await primedClient(
      refusingAfterOne(() => new QuotaExceededError({ source: "bls", resetsAt: RESET })),
    );
    const { result, notes } = await inCall(() => client.getJson<{ n: number }>(URL, TTL));
    expect(result.value).toEqual({ n: 1 });
    expect(notes).toEqual([
      `Served from cache (retrieved ${STORED.toISOString()}): today's service share for bls is spent; resets ${RESET}.`,
    ]);
  });

  it("raises the refusal when the cache holds nothing for the request", async () => {
    const { client } = await primedClient(
      refusingAfterOne(() => new QuotaExceededError({ source: "bls", resetsAt: RESET })),
    );
    await expect(client.getJson("https://api.bls.gov/other", TTL)).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
  });

  it("says the budget's numbers when core's own budget refuses", async () => {
    const client = createHttpClient({
      source: "bls",
      budget: new MemoryBudgetStore(0),
      cache: new MemoryCacheStore(),
      fetch: vi.fn(),
      fixtures: { mode: "off" },
    });
    const error = await client.getJson(URL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error).toMatchObject({ limit: 0, used: 0 });
  });
});

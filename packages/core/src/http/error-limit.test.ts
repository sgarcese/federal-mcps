import { describe, expect, it, vi } from "vitest";
import { MemoryBudgetStore } from "./budget.js";
import { MemoryCacheStore } from "./cache-store.js";
import { createHttpClient } from "./client.js";
import { AgencyApiError, HttpError, UpstreamErrorLimitError } from "./errors.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A manual, injectable clock, same shape as rate-limit.test.ts's. */
function makeClock(startMs = 0) {
  let ms = startMs;
  return {
    now: () => new Date(ms),
    sleep: vi.fn(async (waitMs: number) => {
      ms += waitMs;
    }),
    advance: (waitMs: number) => {
      ms += waitMs;
    },
  };
}

function makeClient(overrides: Partial<Parameters<typeof createHttpClient>[0]> = {}) {
  const fetchFn = vi.fn();
  const clock = makeClock();
  const client = createHttpClient({
    source: "bea",
    budget: new MemoryBudgetStore(500),
    cache: new MemoryCacheStore(),
    fetch: fetchFn,
    fixtures: { mode: "off" },
    now: clock.now,
    sleep: clock.sleep,
    ...overrides,
  });
  return { client, fetchFn, clock };
}

describe("per-minute upstream error limiter (#324, BEA's 30 errors/min)", () => {
  it("allows errorsPerMinute HTTP 4xx failures, then refuses the next call without fetching", async () => {
    const { client, fetchFn } = makeClient({ errorsPerMinute: 2 });
    fetchFn.mockImplementation(async () => jsonResponse({ error: true }, 400));

    await expect(client.getJson("https://bea.example/x?i=0")).rejects.toBeInstanceOf(HttpError);
    await expect(client.getJson("https://bea.example/x?i=1")).rejects.toBeInstanceOf(HttpError);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const err = await client.getJson("https://bea.example/x?i=2").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamErrorLimitError);
    expect((err as UpstreamErrorLimitError).source).toBe("bea");
    expect((err as UpstreamErrorLimitError).errorsPerMinute).toBe(2);
    expect((err as Error).message).toContain("bea");
    // the third call never reached fetch
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("counts a 200-body agency error (bodyError) toward the limit", async () => {
    const { client, fetchFn } = makeClient({
      errorsPerMinute: 1,
      bodyError: () => ({ code: "BAD_PARAM", message: "bad", retryable: false }),
    });
    fetchFn.mockImplementation(async () => jsonResponse({ ok: true }, 200));

    await expect(client.getJson("https://bea.example/x?i=0")).rejects.toBeInstanceOf(
      AgencyApiError,
    );

    const err = await client.getJson("https://bea.example/x?i=1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamErrorLimitError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not count a successful call toward the limit", async () => {
    const { client, fetchFn } = makeClient({ errorsPerMinute: 1 });
    fetchFn.mockImplementation(async () => jsonResponse({ ok: true }, 200));

    await client.getJson("https://bea.example/x?i=0");
    await client.getJson("https://bea.example/x?i=1");

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("resets the error count once the minute rolls over", async () => {
    const { client, fetchFn, clock } = makeClient({ errorsPerMinute: 1 });
    fetchFn.mockImplementation(async () => jsonResponse({ error: true }, 400));

    await expect(client.getJson("https://bea.example/x?i=0")).rejects.toBeInstanceOf(HttpError);
    await expect(client.getJson("https://bea.example/x?i=1")).rejects.toBeInstanceOf(
      UpstreamErrorLimitError,
    );

    clock.advance(60_000);

    await expect(client.getJson("https://bea.example/x?i=2")).rejects.toBeInstanceOf(HttpError);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not apply when errorsPerMinute is not configured", async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockImplementation(async () => jsonResponse({ error: true }, 400));

    for (let i = 0; i < 50; i++) {
      await expect(client.getJson(`https://bea.example/x?i=${i}`)).rejects.toBeInstanceOf(
        HttpError,
      );
    }
    expect(fetchFn).toHaveBeenCalledTimes(50);
  });
});

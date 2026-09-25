import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBudgetStore } from "./budget.js";
import { MemoryCacheStore } from "./cache-store.js";
import { createHttpClient } from "./client.js";
import { RateLimitWaitError } from "./errors.js";
import { writeFixture } from "./fixtures.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * A manual, injectable clock: `sleep` advances it by exactly the requested
 * duration, so waits are deterministic without real timers or fake-timer
 * ticking.
 */
function makeClock(startMs = 0) {
  let ms = startMs;
  return {
    now: () => new Date(ms),
    sleep: vi.fn(async (waitMs: number) => {
      ms += waitMs;
    }),
  };
}

function makeClient(overrides: Partial<Parameters<typeof createHttpClient>[0]> = {}) {
  const fetchFn = vi.fn();
  const clock = makeClock();
  const client = createHttpClient({
    source: "hud",
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

describe("per-minute rate limiter", () => {
  it("allows perMinute immediate calls without waiting", async () => {
    const { client, fetchFn, clock } = makeClient({ perMinute: 60 });
    fetchFn.mockImplementation(async () => jsonResponse({ ok: true }));

    for (let i = 0; i < 60; i++) {
      await client.getJson(`https://hud.example/x?i=${i}`);
    }

    expect(fetchFn).toHaveBeenCalledTimes(60);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("waits for a token on the 61st call, then proceeds", async () => {
    const { client, fetchFn, clock } = makeClient({ perMinute: 60 });
    fetchFn.mockImplementation(async () => jsonResponse({ ok: true }));

    for (let i = 0; i < 60; i++) {
      await client.getJson(`https://hud.example/x?i=${i}`);
    }
    clock.sleep.mockClear();

    const result = await client.getJson<{ ok: boolean }>("https://hud.example/x?i=60");

    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(1000);
    expect(result.value).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(61);
  });

  it("does not consume a token on a cache hit", async () => {
    const { client, fetchFn, clock } = makeClient({ perMinute: 1 });
    fetchFn.mockImplementation(async () => jsonResponse({ ok: true }));

    const first = await client.getJson("https://hud.example/x", { freshTtlSeconds: 3600 });
    expect(first.cache).toEqual({ hit: false });

    const second = await client.getJson("https://hud.example/x", { freshTtlSeconds: 3600 });
    expect(second.cache.hit).toBe(true);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("throws RateLimitWaitError naming the source and limit when the wait would exceed maxWaitMs", async () => {
    const { client, fetchFn, clock } = makeClient({ perMinute: 1, maxWaitMs: 500 });
    fetchFn.mockImplementation(async () => jsonResponse({ ok: true }));

    await client.getJson("https://hud.example/x?i=0");

    const err = await client.getJson("https://hud.example/x?i=1").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitWaitError);
    expect((err as RateLimitWaitError).source).toBe("hud");
    expect((err as RateLimitWaitError).perMinute).toBe(1);
    expect((err as Error).message).toContain("hud");
    expect((err as Error).message).toMatch(/1\/min|1 \/min|limit of 1/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("does not wait when no limiter is configured, however many calls are made", async () => {
    const { client, fetchFn, clock } = makeClient();
    fetchFn.mockImplementation(async () => jsonResponse({ ok: true }));

    for (let i = 0; i < 100; i++) {
      await client.getJson(`https://hud.example/x?i=${i}`);
    }

    expect(fetchFn).toHaveBeenCalledTimes(100);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  describe("fixture replay", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "federal-mcps-rate-limit-fixtures-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("does not consume tokens or wait, even past the limit", async () => {
      await writeFixture(
        dir,
        "hud",
        "https://hud.example/x",
        { status: 200, headers: { "content-type": "application/json" }, body: '{"replayed":true}' },
        () => new Date("2026-09-24T00:00:00.000Z"),
      );
      const { client, fetchFn, clock } = makeClient({
        perMinute: 1,
        fixtures: { mode: "replay", dir },
      });

      for (let i = 0; i < 5; i++) {
        const result = await client.getJson<{ replayed: boolean }>("https://hud.example/x");
        expect(result.value).toEqual({ replayed: true });
      }

      expect(fetchFn).not.toHaveBeenCalled();
      expect(clock.sleep).not.toHaveBeenCalled();
    });
  });

  it("backs off until the minute rolls over when a response reports x-ratelimit-remaining: 0", async () => {
    const { client, fetchFn, clock } = makeClient({ perMinute: 60 });
    fetchFn.mockImplementation(async () =>
      jsonResponse({ ok: true }, 200, { "x-ratelimit-remaining": "0" }),
    );

    await client.getJson("https://hud.example/x?i=0");
    clock.sleep.mockClear();

    const result = await client.getJson<{ ok: boolean }>("https://hud.example/x?i=1");

    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(59_000);
    expect(result.value).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

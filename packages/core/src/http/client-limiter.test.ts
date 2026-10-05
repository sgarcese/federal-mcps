import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentCall, runInCall } from "../limits/context.js";
import { LimitExceededError, type Limiter, type UsageSnapshot } from "../limits/limiter.js";
import type { Caller } from "../server/caller.js";
import { MemoryBudgetStore } from "./budget.js";
import { MemoryCacheStore } from "./cache-store.js";
import { createHttpClient } from "./client.js";
import { writeFixture } from "./fixtures.js";

/**
 * The HTTP client charges each real upstream fetch to the limiter (#322, ADR-020 §2): after the
 * fixture and cache checks, so a cache hit or a replayed fixture costs nothing, and with the
 * caller from the per-call context. Past 80% of a service budget it leaves one note per call.
 */

const NOW = new Date("2026-10-05T12:00:00.000Z");
const CALLER: Caller = { key: "k", kind: "network", labels: {}, bypass: false };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fakeLimiter(snapshot?: UsageSnapshot): Limiter & {
  beforeUpstream: ReturnType<typeof vi.fn>;
} {
  return {
    beginToolCall: vi.fn(async () => undefined),
    beforeUpstream: vi.fn(async () => snapshot),
    usage: vi.fn(async () => snapshot),
  };
}

function makeClient(limiter: Limiter, extra: Partial<Parameters<typeof createHttpClient>[0]> = {}) {
  const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
  const client = createHttpClient({
    source: "bls",
    budget: new MemoryBudgetStore(500),
    cache: new MemoryCacheStore(),
    fetch: fetchFn,
    fixtures: { mode: "off" },
    now: () => NOW,
    limiter,
    ...extra,
  });
  return { client, fetchFn };
}

let dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs = [];
});

describe("createHttpClient: the limiter", () => {
  it("charges a real fetch with the source, the call's caller and the clock", async () => {
    const limiter = fakeLimiter();
    const { client } = makeClient(limiter);
    await runInCall({ caller: CALLER }, () => client.getJson("https://api.bls.gov/x"));
    expect(limiter.beforeUpstream).toHaveBeenCalledTimes(1);
    expect(limiter.beforeUpstream).toHaveBeenCalledWith("bls", CALLER, NOW);
  });

  it("charges with no caller outside a call context", async () => {
    const limiter = fakeLimiter();
    const { client } = makeClient(limiter);
    await client.getJson("https://api.bls.gov/x");
    expect(limiter.beforeUpstream).toHaveBeenCalledWith("bls", undefined, NOW);
  });

  it("does not charge a fresh cache hit", async () => {
    const limiter = fakeLimiter();
    const { client, fetchFn } = makeClient(limiter);
    await client.getJson("https://api.bls.gov/x", { freshTtlSeconds: 3600 });
    await client.getJson("https://api.bls.gov/x", { freshTtlSeconds: 3600 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(limiter.beforeUpstream).toHaveBeenCalledTimes(1);
  });

  it("does not charge a replayed fixture", async () => {
    const dir = await mkdtemp(join(tmpdir(), "federal-mcps-limiter-fixtures-"));
    dirs.push(dir);
    await writeFixture(
      dir,
      "bls",
      "https://api.bls.gov/x",
      { status: 200, headers: { "content-type": "application/json" }, body: '{"replayed":true}' },
      () => NOW,
    );
    const limiter = fakeLimiter();
    const { client, fetchFn } = makeClient(limiter, { fixtures: { mode: "replay", dir } });
    await client.getJson("https://api.bls.gov/x");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(limiter.beforeUpstream).not.toHaveBeenCalled();
  });

  it("lets a LimitExceededError propagate unchanged, before any fetch", async () => {
    const refusal = new LimitExceededError({
      scope: "service",
      kind: "upstream",
      source: "bls",
      limit: 490,
      used: 490,
      resetsAt: "2026-10-06T00:00:00.000Z",
    });
    const limiter = fakeLimiter();
    limiter.beforeUpstream.mockRejectedValueOnce(refusal);
    const { client, fetchFn } = makeClient(limiter);
    await expect(client.getJson("https://api.bls.gov/x")).rejects.toBe(refusal);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("charges inside the stale-on-failure path: a refused query serves the cached entry", async () => {
    let clock = NOW;
    const limiter = fakeLimiter();
    const { client, fetchFn } = makeClient(limiter, { now: () => clock });
    const options = { freshTtlSeconds: 60, staleTtlSeconds: 86_400 };
    await client.getJson("https://api.bls.gov/x", options);
    limiter.beforeUpstream.mockRejectedValueOnce(
      new LimitExceededError({
        scope: "network",
        kind: "upstream",
        source: "bls",
        limit: 100,
        used: 100,
        resetsAt: "2026-10-06T00:00:00.000Z",
      }),
    );
    clock = new Date(NOW.getTime() + 120_000);
    const result = await client.getJson<{ ok: boolean }>("https://api.bls.gov/x", options);
    expect(result.value).toEqual({ ok: true });
    expect(result.cache).toMatchObject({ hit: true, stale: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("leaves one 80% note per call, however many fetches cross it", async () => {
    const limiter = fakeLimiter({
      source: "bls",
      used: 400,
      limit: 490,
      resetsAt: "2026-10-06T00:00:00.000Z",
    });
    const { client } = makeClient(limiter);
    const notes = await runInCall({ caller: CALLER }, async () => {
      await client.getJson("https://api.bls.gov/a");
      await client.getJson("https://api.bls.gov/b");
      return currentCall()?.notes ?? [];
    });
    expect(notes).toEqual([
      "bls daily quota 81% used; later answers may come from cache or be refused until 2026-10-06T00:00:00.000Z.",
    ]);
  });

  it("leaves no note below 80%", async () => {
    const limiter = fakeLimiter({
      source: "bls",
      used: 391,
      limit: 490,
      resetsAt: "2026-10-06T00:00:00.000Z",
    });
    const { client } = makeClient(limiter);
    const notes = await runInCall({}, async () => {
      await client.getJson("https://api.bls.gov/a");
      return currentCall()?.notes ?? [];
    });
    expect(notes).toEqual([]);
  });
});

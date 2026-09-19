import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBudgetStore } from "./budget.js";
import { MemoryCacheStore } from "./cache-store.js";
import { createHttpClient } from "./client.js";
import { HttpError, MissingFixtureError, QuotaExceededError, TimeoutError } from "./errors.js";
import { writeFixture } from "./fixtures.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeClient(overrides: Partial<Parameters<typeof createHttpClient>[0]> = {}) {
  const fetchFn = vi.fn();
  const client = createHttpClient({
    source: "bls",
    budget: new MemoryBudgetStore(500),
    cache: new MemoryCacheStore(),
    fetch: fetchFn,
    fixtures: { mode: "off" },
    ...overrides,
  });
  return { client, fetchFn };
}

describe("createHttpClient basics", () => {
  it("returns getJson and getText, and resolves parsed JSON with status and cache info", async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValueOnce(jsonResponse({ hello: "world" }));

    const result = await client.getJson<{ hello: string }>("https://api.bls.gov/x");

    expect(result.value).toEqual({ hello: "world" });
    expect(result.status).toBe(200);
    expect(result.cache).toEqual({ hit: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("getText resolves the raw body text", async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValueOnce(new Response("plain text", { status: 200 }));

    const result = await client.getText("https://api.bls.gov/x");
    expect(result.value).toBe("plain text");
  });
});

describe("retry policy", () => {
  it("retries 503 up to max attempts then throws a typed HttpError with the attempt count", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchFn } = makeClient();
      fetchFn.mockImplementation(async () => new Response("", { status: 503 }));

      const promise = client.getJson("https://api.bls.gov/x").catch((err) => err);
      await vi.runAllTimersAsync();
      const err = await promise;

      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(503);
      expect(err.attempts).toBe(3);
      expect(fetchFn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("succeeds after a transient 502 followed by a 200", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchFn } = makeClient();
      fetchFn
        .mockResolvedValueOnce(new Response("", { status: 502 }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const promise = client.getJson<{ ok: boolean }>("https://api.bls.gov/x");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.value).toEqual({ ok: true });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry 400/401/403/404", async () => {
    for (const status of [400, 401, 403, 404]) {
      const { client, fetchFn } = makeClient();
      fetchFn.mockResolvedValueOnce(new Response("", { status }));

      const err = await client.getJson("https://api.bls.gov/x").catch((e) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(status);
      expect(err.attempts).toBe(1);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("honours Retry-After (seconds) before retrying", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchFn } = makeClient();
      fetchFn
        .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "10" } }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const promise = client.getJson<{ ok: boolean }>("https://api.bls.gov/x");
      // Advancing by just under 10s must not trigger the retry yet.
      await vi.advanceTimersByTimeAsync(9_999);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const result = await promise;

      expect(result.value).toEqual({ ok: true });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries network errors and eventually throws", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchFn } = makeClient();
      fetchFn.mockRejectedValue(new TypeError("network down"));

      const promise = client.getJson("https://api.bls.gov/x").catch((err) => err);
      await vi.runAllTimersAsync();
      const err = await promise;

      expect(err.source).toBe("bls");
      expect(fetchFn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("timeout", () => {
  it("aborts a never-resolving fetch after the timeout and throws TimeoutError", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchFn } = makeClient({ timeoutMs: 15_000 });
      fetchFn.mockImplementation(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );

      const promise = client.getJson("https://api.bls.gov/x").catch((err) => err);
      await vi.advanceTimersByTimeAsync(15_000);
      const err = await promise;

      expect(err).toBeInstanceOf(TimeoutError);
      expect(err.timeoutMs).toBe(15_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("budget", () => {
  it("the 501st call in a day with limit 500 throws QuotaExceededError before fetch is invoked", async () => {
    const budget = new MemoryBudgetStore(500, () => new Date("2026-09-08T00:00:00.000Z"));
    const { client, fetchFn } = makeClient({ budget });
    fetchFn.mockImplementation(async () => jsonResponse({ ok: true }));

    for (let i = 0; i < 500; i++) {
      await client.getJson(`https://api.bls.gov/x?i=${i}`);
    }
    fetchFn.mockClear();

    const err = await client.getJson("https://api.bls.gov/x?i=501").catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err.resetsAt).toBe("2026-09-09T00:00:00.000Z");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("two-tier cache", () => {
  it("within freshTtl returns the cached value without calling fetch", async () => {
    let now = new Date("2026-09-08T00:00:00.000Z");
    const { client, fetchFn } = makeClient({ now: () => now });
    fetchFn.mockResolvedValueOnce(jsonResponse({ n: 1 }));

    const first = await client.getJson<{ n: number }>("https://api.bls.gov/x", {
      freshTtlSeconds: 3600,
      staleTtlSeconds: 86_400,
    });
    expect(first.cache).toEqual({ hit: false });

    now = new Date("2026-09-08T00:10:00.000Z"); // 600s later, within fresh
    const second = await client.getJson<{ n: number }>("https://api.bls.gov/x", {
      freshTtlSeconds: 3600,
      staleTtlSeconds: 86_400,
    });

    expect(second.value).toEqual({ n: 1 });
    expect(second.cache).toEqual({ hit: true, ageSeconds: 600 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("between freshTtl and staleTtl attempts a fetch, and on failure returns the stale cached value", async () => {
    let now = new Date("2026-09-08T00:00:00.000Z");
    const { client, fetchFn } = makeClient({ now: () => now });
    fetchFn.mockResolvedValueOnce(jsonResponse({ n: 1 }));

    await client.getJson<{ n: number }>("https://api.bls.gov/x", {
      freshTtlSeconds: 60,
      staleTtlSeconds: 3600,
    });

    now = new Date("2026-09-08T00:05:00.000Z"); // 300s later: past fresh(60), within stale(3600)
    fetchFn.mockImplementation(async () => new Response("", { status: 503 }));

    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const promise = client.getJson<{ n: number }>("https://api.bls.gov/x", {
        freshTtlSeconds: 60,
        staleTtlSeconds: 3600,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.value).toEqual({ n: 1 });
      expect(result.cache).toEqual({ hit: true, ageSeconds: 300, stale: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("beyond staleTtl fetches and propagates failure instead of serving stale data", async () => {
    let now = new Date("2026-09-08T00:00:00.000Z");
    const { client, fetchFn } = makeClient({ now: () => now });
    fetchFn.mockResolvedValueOnce(jsonResponse({ n: 1 }));

    await client.getJson<{ n: number }>("https://api.bls.gov/x", {
      freshTtlSeconds: 60,
      staleTtlSeconds: 120,
    });

    now = new Date("2026-09-08T00:10:00.000Z"); // 600s later: past stale(120)
    fetchFn.mockImplementation(async () => new Response("", { status: 503 }));

    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const promise = client
        .getJson<{ n: number }>("https://api.bls.gov/x", {
          freshTtlSeconds: 60,
          staleTtlSeconds: 120,
        })
        .catch((err) => err);
      await vi.runAllTimersAsync();
      const err = await promise;

      expect(err).toBeInstanceOf(HttpError);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fixtures", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "federal-mcps-client-fixtures-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("record mode performs the real fetch (through the injected fetch) and writes a fixture", async () => {
    const budget = new MemoryBudgetStore(500);
    const { client, fetchFn } = makeClient({ budget, fixtures: { mode: "record", dir } });
    fetchFn.mockResolvedValueOnce(jsonResponse({ recorded: true }));

    const result = await client.getJson<{ recorded: boolean }>("https://api.bls.gov/x");

    expect(result.value).toEqual({ recorded: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const { readFixture } = await import("./fixtures.js");
    const fixture = await readFixture(dir, "bls", "https://api.bls.gov/x");
    expect(JSON.parse(fixture.body)).toEqual({ recorded: true });
  });

  it("replay mode serves from disk without calling fetch or consuming budget", async () => {
    await writeFixture(
      dir,
      "bls",
      "https://api.bls.gov/x",
      { status: 200, headers: { "content-type": "application/json" }, body: '{"replayed":true}' },
      () => new Date("2026-09-08T00:00:00.000Z"),
    );
    const budget = new MemoryBudgetStore(500);
    const consumeSpy = vi.spyOn(budget, "consume");
    const { client, fetchFn } = makeClient({ budget, fixtures: { mode: "replay", dir } });

    const result = await client.getJson<{ replayed: boolean }>("https://api.bls.gov/x");

    expect(result.value).toEqual({ replayed: true });
    expect(result.cache).toEqual({ hit: false });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("replay mode throws MissingFixtureError naming the exact path when the fixture is absent", async () => {
    const { client } = makeClient({ fixtures: { mode: "replay", dir } });

    const err = await client.getJson("https://api.bls.gov/missing").catch((e) => e);

    expect(err).toBeInstanceOf(MissingFixtureError);
    expect(err.path).toContain(dir);
    expect(err.path).toContain("bls");
  });
});

describe("postJson", () => {
  it("POSTs the JSON body with a content-type and parses the JSON response", async () => {
    const { client, fetchFn } = makeClient();
    fetchFn.mockResolvedValueOnce(jsonResponse({ status: "REQUEST_SUCCEEDED" }));

    const result = await client.postJson<{ status: string }>("https://api.bls.gov/x", {
      seriesid: ["LAUCN080310000000003"],
    });

    expect(result.value).toEqual({ status: "REQUEST_SUCCEEDED" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ seriesid: ["LAUCN080310000000003"] });
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("consumes budget and caches keyed by the body (same URL, different bodies miss separately)", async () => {
    const budget = new MemoryBudgetStore(500);
    const { client, fetchFn } = makeClient({ budget });
    fetchFn.mockImplementation(async () => jsonResponse({ ok: true }));

    const a1 = await client.postJson(
      "https://api.bls.gov/x",
      { seriesid: ["A"] },
      { freshTtlSeconds: 60 },
    );
    const a2 = await client.postJson(
      "https://api.bls.gov/x",
      { seriesid: ["A"] },
      { freshTtlSeconds: 60 },
    );
    const b1 = await client.postJson(
      "https://api.bls.gov/x",
      { seriesid: ["B"] },
      { freshTtlSeconds: 60 },
    );

    expect(a1.cache).toEqual({ hit: false });
    expect(a2.cache).toMatchObject({ hit: true }); // same body → cache hit, no second fetch
    expect(b1.cache).toEqual({ hit: false }); // different body → separate entry, real fetch
    expect(fetchFn).toHaveBeenCalledTimes(2); // A once, B once; A's repeat served from cache
  });
});

describe("queryAuth (M8.2): a key appended at fetch time only", () => {
  it("sends the key on the wire but keeps it out of the cache key, the fixture path and errors", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response("[1]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const cache = new MemoryCacheStore();
    const client = createHttpClient({
      source: "demo",
      budget: new MemoryBudgetStore(10),
      cache,
      fetch: fetchImpl,
      fixtures: { mode: "off" },
    });
    const url = "https://example.invalid/data?get=NAME&ucgid=0500000US08031";
    const first = await client.getJson<number[]>(url, {
      freshTtlSeconds: 60,
      queryAuth: { key: "SECRET-KEY" },
    });
    expect(first.value).toEqual([1]);
    expect(seen).toEqual([`${url}&key=SECRET-KEY`]);

    // A second call with the same clean URL is a cache hit: the key is not part of the identity.
    const second = await client.getJson<number[]>(url, { freshTtlSeconds: 60, queryAuth: { key: "OTHER" } });
    expect(second.cache.hit).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("names only the clean URL in an HttpError", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const client = createHttpClient({
      source: "demo",
      budget: new MemoryBudgetStore(10),
      cache: new MemoryCacheStore(),
      fetch: fetchImpl,
      fixtures: { mode: "off" },
    });
    await expect(
      client.getJson("https://example.invalid/data?get=NAME", { queryAuth: { key: "SECRET-KEY" } }),
    ).rejects.toMatchObject({ url: "https://example.invalid/data?get=NAME" });
  });
});

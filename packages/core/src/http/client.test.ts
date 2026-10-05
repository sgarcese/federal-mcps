import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBudgetStore } from "./budget.js";
import { MemoryCacheStore } from "./cache-store.js";
import { createHttpClient } from "./client.js";
import {
  AgencyApiError,
  HttpError,
  MissingFixtureError,
  QuotaExceededError,
  TimeoutError,
} from "./errors.js";
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
    const second = await client.getJson<number[]>(url, {
      freshTtlSeconds: 60,
      queryAuth: { key: "OTHER" },
    });
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

describe("cacheBody (#325): a POST credential kept out of the cache/fixture identity", () => {
  it("hashes the cache key from cacheBody, not the real wire body, when given", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = createHttpClient({
      source: "demo",
      budget: new MemoryBudgetStore(10),
      cache: new MemoryCacheStore(),
      fetch: fetchImpl,
      fixtures: { mode: "off" },
    });

    const first = await client.postJson<{ ok: boolean }>(
      "https://example.invalid/data",
      { seriesid: ["A"], registrationkey: "KEY-ONE" },
      { freshTtlSeconds: 60, cacheBody: JSON.stringify({ seriesid: ["A"] }) },
    );
    expect(first.cache.hit).toBe(false);
    expect(seen).toEqual(['{"seriesid":["A"],"registrationkey":"KEY-ONE"}']);

    // A second call with a different real body (different key) but the same `cacheBody` is a
    // cache hit: the key never touched the identity, and the real body is never sent again.
    const second = await client.postJson<{ ok: boolean }>(
      "https://example.invalid/data",
      { seriesid: ["A"], registrationkey: "KEY-TWO" },
      { freshTtlSeconds: 60, cacheBody: JSON.stringify({ seriesid: ["A"] }) },
    );
    expect(second.cache.hit).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("uses cacheBody for the recorded fixture's identity too", async () => {
    const dir = await mkdtemp(join(tmpdir(), "federal-mcps-fixtures-"));
    try {
      const fetchImpl = (async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch;
      const record = createHttpClient({
        source: "demo",
        budget: new MemoryBudgetStore(10),
        cache: new MemoryCacheStore(),
        fetch: fetchImpl,
        fixtures: { mode: "record", dir },
      });
      await record.postJson(
        "https://example.invalid/data",
        { seriesid: ["A"], registrationkey: "KEY-ONE" },
        { cacheBody: JSON.stringify({ seriesid: ["A"] }) },
      );

      // Replay with a *different* key in the real body but the same cacheBody: it must find
      // the fixture recorded above, never touching the network.
      const replayFetch = vi.fn(() => {
        throw new Error("replay must not hit the network");
      });
      const replay = createHttpClient({
        source: "demo",
        budget: new MemoryBudgetStore(10),
        cache: new MemoryCacheStore(),
        fetch: replayFetch as unknown as typeof fetch,
        fixtures: { mode: "replay", dir },
      });
      const result = await replay.postJson(
        "https://example.invalid/data",
        { seriesid: ["A"], registrationkey: "KEY-TWO" },
        { cacheBody: JSON.stringify({ seriesid: ["A"] }) },
      );
      expect(result.value).toEqual({ ok: true });
      expect(replayFetch).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("sanitize and bodyError hooks (#256, ADR-019 §3–4)", () => {
  // A BEA-shaped reply: the key echoed back, and errors answered with HTTP 200.
  const KEY = "11111111-2222-3333-4444-555555555555";
  const beaBody = (results: unknown) => ({
    BEAAPI: {
      Request: { RequestParam: [{ ParameterName: "USERID", ParameterValue: KEY }] },
      Results: results,
    },
  });
  const redactKey = (body: string) => body.split(KEY).join("<redacted>");
  const beaError = (body: string) => {
    const code = (
      JSON.parse(body) as {
        BEAAPI?: { Results?: { Error?: { APIErrorCode?: string; APIErrorDescription?: string } } };
      }
    ).BEAAPI?.Results?.Error;
    if (!code?.APIErrorCode) return undefined;
    return {
      code: code.APIErrorCode,
      message: code.APIErrorDescription ?? "",
      retryable: !["4", "40", "101"].includes(code.APIErrorCode),
    };
  };

  it("sanitize runs before the value is returned or cached: the echoed key is never in either", async () => {
    const cache = new MemoryCacheStore();
    const { client, fetchFn } = makeClient({ sanitize: redactKey, cache });
    fetchFn.mockResolvedValue(jsonResponse(beaBody({ Data: [{ DataValue: "1" }] })));
    const first = await client.getJson("https://apps.bea.gov/api/data?x=1", {
      freshTtlSeconds: 60,
    });
    expect(JSON.stringify(first.value)).not.toContain(KEY);
    const cached = await client.getJson("https://apps.bea.gov/api/data?x=1", {
      freshTtlSeconds: 60,
    });
    expect(cached.cache.hit).toBe(true);
    expect(JSON.stringify(cached.value)).not.toContain(KEY);
  });

  it("sanitize runs before a fixture is recorded: the key never reaches disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sanitize-"));
    try {
      const { client, fetchFn } = makeClient({
        sanitize: redactKey,
        fixtures: { mode: "record", dir },
      });
      fetchFn.mockResolvedValue(jsonResponse(beaBody({ Data: [] })));
      await client.getJson("https://apps.bea.gov/api/data?x=2");
      const { readdir, readFile } = await import("node:fs/promises");
      const files = await readdir(join(dir, "bls"));
      const text = await readFile(join(dir, "bls", files[0] as string), "utf8");
      expect(text).not.toContain(KEY);
      expect(text).toContain("<redacted>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bodyError turns an error answered with HTTP 200 into a typed AgencyApiError, not a value", async () => {
    const { client, fetchFn } = makeClient({ sanitize: redactKey, bodyError: beaError });
    fetchFn.mockResolvedValue(
      jsonResponse(
        beaBody({
          Error: {
            APIErrorCode: "40",
            APIErrorDescription: "Invalid Value for Parameter TableName",
          },
        }),
      ),
    );
    const err = await client.getJson("https://apps.bea.gov/api/data?x=3").catch((e) => e);
    expect(err).toBeInstanceOf(AgencyApiError);
    expect(err).toMatchObject({ source: "bls", code: "40", attempts: 1 });
    expect(err.message).toContain("Invalid Value for Parameter TableName");
    expect(err.message).not.toContain(KEY);
  });

  it("a non-retryable body error is never retried (it spends the agency's error budget)", async () => {
    const { client, fetchFn } = makeClient({ bodyError: beaError });
    fetchFn.mockResolvedValue(
      jsonResponse(
        beaBody({ Error: { APIErrorCode: "101", APIErrorDescription: "Unknown error." } }),
      ),
    );
    await client.getJson("https://apps.bea.gov/api/data?x=4").catch(() => undefined);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a retryable body error is retried with backoff, then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const { client, fetchFn } = makeClient({ bodyError: beaError });
      fetchFn
        .mockResolvedValueOnce(
          jsonResponse(
            beaBody({
              Error: {
                APIErrorCode: "7",
                APIErrorDescription: "exceeded Requests per minute quota",
              },
            }),
          ),
        )
        .mockResolvedValueOnce(jsonResponse(beaBody({ Data: [{ DataValue: "5" }] })));
      const promise = client.getJson<{ BEAAPI: { Results: { Data: unknown[] } } }>(
        "https://apps.bea.gov/api/data?x=5",
      );
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.value.BEAAPI.Results.Data).toHaveLength(1);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an error body is never cached or recorded", async () => {
    const cache = new MemoryCacheStore();
    const { client, fetchFn } = makeClient({ bodyError: beaError, cache });
    fetchFn
      .mockResolvedValueOnce(
        jsonResponse(beaBody({ Error: { APIErrorCode: "40", APIErrorDescription: "bad" } })),
      )
      .mockResolvedValueOnce(jsonResponse(beaBody({ Data: [] })));
    await client
      .getJson("https://apps.bea.gov/api/data?x=6", { freshTtlSeconds: 60 })
      .catch(() => undefined);
    const second = await client.getJson("https://apps.bea.gov/api/data?x=6", {
      freshTtlSeconds: 60,
    });
    expect(second.cache.hit).toBe(false);
  });
});

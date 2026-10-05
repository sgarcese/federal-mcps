import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  MemoryBudgetStore,
  MemoryCacheStore,
  QuotaExceededError,
} from "@federal-mcps/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLS_SERIES_ENDPOINT,
  BLS_TIMESERIES_CACHE_TTL_SECONDS,
  blsDailyThresholdBodyError,
  fetchSeriesObservations,
  fetchSeriesObservationsWithCache,
  fetchSeriesRaw,
  fetchSeriesRawWithCache,
} from "./series-fetch.js";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

/** A replay client: serves the recorded fixture, and fails loudly if it touches the network. */
function replayClient() {
  const fetchFn = vi.fn(() => {
    throw new Error("replay must not hit the network");
  });
  return createHttpClient({
    source: "bls",
    budget: new MemoryBudgetStore(500),
    cache: new MemoryCacheStore(),
    fetch: fetchFn as unknown as typeof fetch,
    fixtures: { mode: "replay", dir: FIXTURE_DIR },
  });
}

/**
 * A client whose fetch returns a scripted JSON response (fixtures off), for shape/error tests.
 * Wires `blsDailyThresholdBodyError` by default, the same way `index.ts` does in production
 * (#325), so a daily-threshold refusal is caught before anything is cached, same as it would be
 * for a real call.
 */
function scriptedClient(
  handler: () => Response,
  overrides: Partial<Parameters<typeof createHttpClient>[0]> = {},
) {
  const fetchFn = vi.fn(async () => handler());
  const cache = new MemoryCacheStore();
  const client = createHttpClient({
    source: "bls",
    budget: new MemoryBudgetStore(500),
    cache,
    fetch: fetchFn as unknown as typeof fetch,
    fixtures: { mode: "off" },
    bodyError: blsDailyThresholdBodyError,
    ...overrides,
  });
  return { client, fetchFn, cache };
}

describe("fetchSeriesObservations (recorded fixture)", () => {
  it("replays real Denver County and LA County unemployment-rate series offline", async () => {
    const out = await fetchSeriesObservations(
      replayClient(),
      ["LAUCN080310000000003", "LAUCN060370000000003"],
      { startYear: 2023, endYear: 2024 },
    );
    expect(out.map((s) => s.seriesId)).toEqual(["LAUCN080310000000003", "LAUCN060370000000003"]);
    const denver = out[0];
    expect(denver?.observations.length).toBe(24); // 2 years x 12 months
    const latest = denver?.observations[0]; // BLS returns newest first
    expect(latest).toMatchObject({ year: "2024", period: "M12", value: 4.5 });
    expect(typeof latest?.value).toBe("number");
  });
});

describe("the national benchmark series (recorded fixture, #290)", () => {
  it("replays the nation's CPS, CES, JOLTS, OEWS and CPI series offline", async () => {
    // Recorded 2026-09-30 in one keyless request, 2024–2025.
    const ids = [
      "LNU04000000",
      "LNU03000000",
      "LNU02000000",
      "LNU01000000",
      "LNS14000000",
      "CEU0000000001",
      "JTU000000000000000JOL",
      "OEUN000000000000000000004",
      "CUUR0000SA0",
    ];
    const out = await fetchSeriesObservations(replayClient(), ids, {
      startYear: 2024,
      endYear: 2025,
    });
    expect(out.map((s) => s.seriesId)).toEqual(ids);
    const latest = Object.fromEntries(out.map((s) => [s.seriesId, s.observations[0]?.value]));
    expect(latest).toMatchObject({
      LNU04000000: 4.1,
      LNS14000000: 4.4,
      LNU03000000: 7003,
      LNU02000000: 163720,
      LNU01000000: 170723,
      CEU0000000001: 159358,
      JTU000000000000000JOL: 6088,
      OEUN000000000000000000004: 69770,
      CUUR0000SA0: 324.054,
    });
  });
});

describe("fetchSeriesObservations parsing and batching", () => {
  const ok = (series: unknown[]) =>
    new Response(JSON.stringify({ status: "REQUEST_SUCCEEDED", Results: { series } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("parses a suppressed value as null and keeps footnote codes", async () => {
    const { client } = scriptedClient(() =>
      ok([
        {
          seriesID: "LAUCN080310000000003",
          data: [
            {
              year: "2024",
              period: "M06",
              periodName: "June",
              value: "3.9",
              footnotes: [{ code: "P", text: "preliminary" }],
            },
            { year: "2024", period: "M05", periodName: "May", value: "", footnotes: [{}] },
          ],
        },
      ]),
    );
    const [s] = await fetchSeriesObservations(client, ["LAUCN080310000000003"]);
    expect(s?.observations[0]).toMatchObject({
      value: 3.9,
      footnotes: [{ code: "P", text: "preliminary" }],
    });
    expect(s?.observations[1]?.value).toBeNull();
    expect(s?.observations[1]?.footnotes).toEqual([]); // an empty footnote {} is dropped
  });

  it("batches more than 50 series into separate requests", async () => {
    const { client, fetchFn } = scriptedClient(() => ok([]));
    const ids = Array.from({ length: 120 }, (_, i) => `LAUCN${String(i).padStart(13, "0")}03`);
    await fetchSeriesObservations(client, ids);
    expect(fetchFn).toHaveBeenCalledTimes(3); // 50 + 50 + 20
    expect(fetchFn.mock.calls[0]?.[0]).toBe(BLS_SERIES_ENDPOINT);
  });

  it("throws with the API message when the request is not processed for a reason other than the daily threshold", async () => {
    const { client } = scriptedClient(
      () =>
        new Response(
          JSON.stringify({
            status: "REQUEST_NOT_PROCESSED",
            message: ["series does not exist"],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    await expect(fetchSeriesObservations(client, ["LAUCN080310000000003"])).rejects.toThrow(
      /series does not exist/,
    );
    await expect(
      fetchSeriesObservations(client, ["LAUCN080310000000003"]),
    ).rejects.not.toBeInstanceOf(QuotaExceededError);
  });
});

describe("a BLS daily-threshold refusal (#325, ADR-020 §8)", () => {
  const refusal = () =>
    new Response(
      JSON.stringify({
        status: "REQUEST_NOT_PROCESSED",
        message: [
          "Request could not be serviced, as the daily threshold for total number of " +
            "requests allocated to the user with registration key XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX " +
            "has been reached.",
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T15:30:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("raises QuotaExceededError with a UTC-midnight resetsAt, for the indicator fetch", async () => {
    const { client } = scriptedClient(refusal);
    const err: unknown = await fetchSeriesObservations(client, ["LAUCN080310000000003"]).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).source).toBe("bls");
    expect((err as QuotaExceededError).resetsAt).toBe("2026-10-06T00:00:00.000Z");
  });

  it("raises QuotaExceededError for the raw fetch too (bls_get_raw's path)", async () => {
    const { client } = scriptedClient(refusal);
    await expect(fetchSeriesRaw(client, ["LAUCN080310000000003"])).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
  });

  it("replays a synthesized daily-threshold fixture (no live refusal recorded yet, #325) as QuotaExceededError", async () => {
    // fixtures/bls/df5dc8cf…json: BLS's documented wording for this refusal, synthesized (not a
    // live recording — see `blsDailyThresholdBodyError`'s doc comment for the source).
    await expect(
      fetchSeriesObservations(replayClient(), ["LAUCN080310000000003"]),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("is caught by the bodyError hook as an AgencyApiError before parse/cache (the hook's own contract)", () => {
    const err = blsDailyThresholdBodyError(
      JSON.stringify({
        status: "REQUEST_NOT_PROCESSED",
        message: ["daily threshold for total number of requests has been reached"],
      }),
    );
    expect(err).toMatchObject({ retryable: false });
  });

  it("never caches the refusal: a later call still hits the network, not a 'fresh' cache entry", async () => {
    const { client, fetchFn } = scriptedClient(refusal);
    await expect(fetchSeriesObservations(client, ["LAUCN080310000000003"])).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // If the refusal had been cached under a 24h-fresh entry, this second call would be
    // served from cache instead of refetching — the bodyError hook throws before
    // getWithCache's cache.set ever runs, so it refetches instead.
    await expect(fetchSeriesObservations(client, ["LAUCN080310000000003"])).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    expect(fetchFn).toHaveBeenCalledTimes(2); // refetched, not served from a cached refusal
  });

  it("leaves other REQUEST_NOT_PROCESSED reasons as the generic error, not QuotaExceededError", async () => {
    const { client } = scriptedClient(
      () =>
        new Response(JSON.stringify({ status: "REQUEST_NOT_PROCESSED", message: ["bad syntax"] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const err: unknown = await fetchSeriesObservations(client, ["LAUCN080310000000003"]).catch(
      (e) => e,
    );
    expect(err).not.toBeInstanceOf(QuotaExceededError);
    expect((err as Error).message).toMatch(/bad syntax/);
  });
});

describe("the 24h timeseries cache TTL (#325, ADR-020 §8)", () => {
  const ok = (series: unknown[] = []) =>
    new Response(JSON.stringify({ status: "REQUEST_SUCCEEDED", Results: { series } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("sets a 24h freshTtlSeconds on every timeseries POST, for both the indicator and raw paths", async () => {
    const postJson = vi.fn(async () => ({
      value: { status: "REQUEST_SUCCEEDED", Results: { series: [] } },
      cache: { hit: false },
      status: 200,
    }));
    const client = { postJson } as unknown as Parameters<typeof fetchSeriesObservations>[0];

    await fetchSeriesObservations(client, ["LAUCN080310000000003"]);
    expect(postJson).toHaveBeenLastCalledWith(
      BLS_SERIES_ENDPOINT,
      expect.anything(),
      expect.objectContaining({ freshTtlSeconds: BLS_TIMESERIES_CACHE_TTL_SECONDS }),
    );

    await fetchSeriesRaw(client, ["LAUCN080310000000003"]);
    expect(postJson).toHaveBeenLastCalledWith(
      BLS_SERIES_ENDPOINT,
      expect.anything(),
      expect.objectContaining({ freshTtlSeconds: BLS_TIMESERIES_CACHE_TTL_SECONDS }),
    );
  });

  it("serves a fresh cache hit within 24h, and refetches once the TTL has elapsed", async () => {
    let current = new Date("2026-10-05T00:00:00.000Z");
    const fetchFn = vi.fn(async () => ok([]));
    const client = createHttpClient({
      source: "bls",
      budget: new MemoryBudgetStore(500),
      cache: new MemoryCacheStore(),
      fetch: fetchFn as unknown as typeof fetch,
      fixtures: { mode: "off" },
      now: () => current,
    });

    const { cache: firstCache } = await fetchSeriesObservationsWithCache(client, [
      "LAUCN080310000000003",
    ]);
    expect(firstCache.hit).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    current = new Date(current.getTime() + 23 * 60 * 60 * 1000); // +23h: still fresh
    const { cache: secondCache } = await fetchSeriesObservationsWithCache(client, [
      "LAUCN080310000000003",
    ]);
    expect(secondCache.hit).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1); // no refetch

    current = new Date(current.getTime() + 2 * 60 * 60 * 1000); // +2h more: past 24h
    const { cache: thirdCache } = await fetchSeriesObservationsWithCache(client, [
      "LAUCN080310000000003",
    ]);
    expect(thirdCache.hit).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2); // refetched
  });

  it("still serves a stale cache entry when BLS fails on refetch", async () => {
    let current = new Date("2026-10-05T00:00:00.000Z");
    let fail = false;
    const fetchFn = vi.fn(async () => {
      if (fail) return new Response("nope", { status: 500 });
      return ok([]);
    });
    const client = createHttpClient({
      source: "bls",
      budget: new MemoryBudgetStore(500),
      cache: new MemoryCacheStore(),
      fetch: fetchFn as unknown as typeof fetch,
      fixtures: { mode: "off" },
      now: () => current,
    });

    await fetchSeriesObservationsWithCache(client, ["LAUCN080310000000003"]);
    current = new Date(current.getTime() + 25 * 60 * 60 * 1000); // past the 24h fresh window
    fail = true;
    const { cache } = await fetchSeriesObservationsWithCache(client, ["LAUCN080310000000003"]);
    expect(cache).toMatchObject({ hit: true, stale: true });
  });
});

describe("the cache key stays keyless regardless of registrationkey (#325)", () => {
  it("two calls that differ only by apiKey hit the same cache entry", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "REQUEST_SUCCEEDED", Results: { series: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createHttpClient({
      source: "bls",
      budget: new MemoryBudgetStore(500),
      cache: new MemoryCacheStore(),
      fetch: fetchFn as unknown as typeof fetch,
      fixtures: { mode: "off" },
    });

    const first = await fetchSeriesObservationsWithCache(client, ["LAUCN080310000000003"], {
      apiKey: "KEY-ONE",
    });
    expect(first.cache.hit).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const second = await fetchSeriesObservationsWithCache(client, ["LAUCN080310000000003"], {
      apiKey: "KEY-TWO",
    });
    expect(second.cache.hit).toBe(true); // same cache entry despite a different key
    expect(fetchFn).toHaveBeenCalledTimes(1); // no second network call

    // The key still rode on the wire for the real (first) request.
    const [, firstInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(firstInit.body)).toContain("KEY-ONE");
  });

  it("fetchSeriesRawWithCache carries the same merged cache info", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "REQUEST_SUCCEEDED", Results: { series: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createHttpClient({
      source: "bls",
      budget: new MemoryBudgetStore(500),
      cache: new MemoryCacheStore(),
      fetch: fetchFn as unknown as typeof fetch,
      fixtures: { mode: "off" },
    });
    await fetchSeriesRawWithCache(client, ["LAUCN080310000000003"], { apiKey: "KEY-ONE" });
    const second = await fetchSeriesRawWithCache(client, ["LAUCN080310000000003"], {
      apiKey: "KEY-TWO",
    });
    expect(second.cache.hit).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

// Live smoke: hits the real BLS API. Runs only with LIVE_TESTS=1 (never a merge gate,
// CLAUDE.md). Uses BLS_API_KEY when present, else the unregistered path.
describe.runIf(process.env.LIVE_TESTS === "1")("fetchSeriesObservations LIVE", () => {
  it("fetches a real Denver County unemployment rate", async () => {
    const client = createHttpClient({
      source: "bls",
      budget: new MemoryBudgetStore(25),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "off" },
    });
    const year = new Date().getFullYear();
    const opts = process.env.BLS_API_KEY ? { apiKey: process.env.BLS_API_KEY } : {};
    const [denver] = await fetchSeriesObservations(client, ["LAUCN080310000000003"], {
      startYear: year - 1,
      endYear: year,
      ...opts,
    });
    expect(denver?.seriesId).toBe("LAUCN080310000000003");
    expect(denver?.observations.length).toBeGreaterThan(0);
    expect(typeof denver?.observations[0]?.value).toBe("number");
  }, 20_000);
});

import { fileURLToPath } from "node:url";
import { createHttpClient, MemoryBudgetStore, MemoryCacheStore } from "@federal-mcps/core";
import { describe, expect, it, vi } from "vitest";
import { fetchLausObservations, LAUS_ENDPOINT } from "./laus-fetch.js";

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

/** A client whose fetch returns a scripted JSON response (fixtures off), for shape/error tests. */
function scriptedClient(handler: () => Response) {
  const fetchFn = vi.fn(async () => handler());
  const client = createHttpClient({
    source: "bls",
    budget: new MemoryBudgetStore(500),
    cache: new MemoryCacheStore(),
    fetch: fetchFn as unknown as typeof fetch,
    fixtures: { mode: "off" },
  });
  return { client, fetchFn };
}

describe("fetchLausObservations (recorded fixture)", () => {
  it("replays real Denver County and LA County unemployment-rate series offline", async () => {
    const out = await fetchLausObservations(
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

describe("fetchLausObservations parsing and batching", () => {
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
    const [s] = await fetchLausObservations(client, ["LAUCN080310000000003"]);
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
    await fetchLausObservations(client, ids);
    expect(fetchFn).toHaveBeenCalledTimes(3); // 50 + 50 + 20
    expect(fetchFn.mock.calls[0]?.[0]).toBe(LAUS_ENDPOINT);
  });

  it("throws with the API message when the request is not processed", async () => {
    const { client } = scriptedClient(
      () =>
        new Response(
          JSON.stringify({ status: "REQUEST_NOT_PROCESSED", message: ["daily threshold reached"] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    await expect(fetchLausObservations(client, ["LAUCN080310000000003"])).rejects.toThrow(
      /daily threshold reached/,
    );
  });
});

// Live smoke: hits the real BLS API. Runs only with LIVE_TESTS=1 (never a merge gate,
// CLAUDE.md). Uses BLS_API_KEY when present, else the unregistered path.
describe.runIf(process.env.LIVE_TESTS === "1")("fetchLausObservations LIVE", () => {
  it("fetches a real Denver County unemployment rate", async () => {
    const client = createHttpClient({
      source: "bls",
      budget: new MemoryBudgetStore(25),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "off" },
    });
    const year = new Date().getFullYear();
    const opts = process.env.BLS_API_KEY ? { apiKey: process.env.BLS_API_KEY } : {};
    const [denver] = await fetchLausObservations(client, ["LAUCN080310000000003"], {
      startYear: year - 1,
      endYear: year,
      ...opts,
    });
    expect(denver?.seriesId).toBe("LAUCN080310000000003");
    expect(denver?.observations.length).toBeGreaterThan(0);
    expect(typeof denver?.observations[0]?.value).toBe("number");
  }, 20_000);
});

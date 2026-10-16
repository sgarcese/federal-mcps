import { DeadlineExceededError, type HttpClient, type HttpResult } from "@federal-mcps/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QCEW_CALL_DEADLINE_MS,
  QCEW_CONCURRENCY,
  qcewIndicatorDefinitions,
} from "./qcew-indicators.js";

/**
 * The QCEW call deadline and bounded concurrency (#351). A cold call fetches every history slice
 * in parallel; one stalled upstream request must never block the whole call past the Lambda
 * timeout. This stubs `HttpClient.getText` directly (no core client involved) so a "stalled" slice
 * is simulated by never resolving until its `signal` aborts — exactly how the core client's
 * `DeadlineExceededError` behaves once #351's `signal` support lands there.
 */

const QH =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage"';

function quarterCsv(year: number, q: number): string {
  const wage = 1500 + (year - 2014) * 20 + q;
  return [QH, `"18141","0","10","70","0","${year}","${q}","",1,1,1,1,1,1,1,${wage}`].join("\n");
}

const def = (name: string) => qcewIndicatorDefinitions.find((d) => d.name === name);
async function fetchWage(client: HttpClient, key: string, opts: Record<string, unknown>) {
  const f = def("average_weekly_wage")?.fetch;
  if (!f) throw new Error("no fetch");
  const [r] = await f(client, [key], opts);
  return r;
}

/** A getText stub that resolves instantly for ordinary quarters, and stalls (never resolving on
 * its own) for a set of "stuck" quarters — settling only when its `signal` aborts, exactly as the
 * real client throws `DeadlineExceededError` once #351's deadline fires. */
function makeStallingClient(stuckQuarters: ReadonlySet<string>) {
  let inFlight = 0;
  let maxInFlight = 0;
  const client: HttpClient = {
    getJson: () => {
      throw new Error("only getText");
    },
    postJson: () => {
      throw new Error("only getText");
    },
    async getText(
      url: string,
      options?: { signal?: AbortSignal },
    ): Promise<HttpResult<string>> {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const q = /\/api\/(\d{4})\/(\d)\/area\//.exec(url);
      if (!q) throw new Error(`unexpected url ${url}`);
      const year = Number(q[1]);
      const quarter = Number(q[2]);
      const key = `${year}-${quarter}`;
      try {
        if (stuckQuarters.has(key)) {
          return await new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new DeadlineExceededError({ source: "bls-qcew", url }));
            });
          });
        }
        return { value: quarterCsv(year, quarter), status: 200, cache: { hit: false } };
      } finally {
        inFlight--;
      }
    },
  };
  return { client, maxInFlight: () => maxInFlight };
}

describe("QCEW call deadline (#351)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("one stalled slice among 8 gives a partial answer within the budget, naming the missing quarter", async () => {
    const { client } = makeStallingClient(new Set(["2023-3"]));
    const promise = fetchWage(client, "18141|5|23", {
      startYear: 2023,
      endYear: 2024,
      explicitYears: true,
    });
    await vi.advanceTimersByTimeAsync(QCEW_CALL_DEADLINE_MS);
    const r = await promise;

    expect(r?.observations).toHaveLength(7);
    expect(r?.observations.some((o) => o.year === "2023" && o.period === "Q03")).toBe(false);
    expect(r?.notes?.join(" ")).toMatch(/2023 Q3/);
    expect(r?.notes?.join(" ")).toMatch(/not retrieved within the time limit/);
  });

  it("every slice stalled gives an unavailable/error outcome within the budget, never a crash with no envelope", async () => {
    const { client } = makeStallingClient(
      new Set(["2024-1", "2024-2", "2024-3", "2024-4", "2023-4", "2023-3", "2023-2", "2023-1"]),
    );
    const promise = fetchWage(client, "18141|5|23", {
      startYear: 2023,
      endYear: 2024,
      explicitYears: true,
    }).catch((err) => err);
    await vi.advanceTimersByTimeAsync(QCEW_CALL_DEADLINE_MS);
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/time limit/);
  });

  it("no more than ~6 slices are in flight at any moment", async () => {
    const { client, maxInFlight } = makeStallingClient(new Set());
    await fetchWage(client, "18141|5|23", {
      startYear: 2009,
      endYear: 2020,
      explicitYears: true,
    });
    expect(maxInFlight()).toBeLessThanOrEqual(QCEW_CONCURRENCY);
    expect(maxInFlight()).toBeGreaterThan(1);
  });

  it("the normal fast path (no stalls) is unaffected by the deadline machinery", async () => {
    const { client } = makeStallingClient(new Set());
    const r = await fetchWage(client, "18141|5|23", {
      startYear: 2024,
      endYear: 2024,
      explicitYears: true,
    });
    expect(r?.observations).toHaveLength(4);
    expect(r?.notes).toBeUndefined();
  });
});

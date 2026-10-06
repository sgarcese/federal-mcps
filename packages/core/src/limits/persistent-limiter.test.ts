import { afterEach, describe, expect, it, vi } from "vitest";
import type { Caller } from "../server/caller.js";
import type { LimitsConfig } from "./config.js";
import { type CounterStore, MemoryCounterStore } from "./counter-store.js";
import { LimitExceededError } from "./limiter.js";
import { createLimiter, LIMITER_DEGRADED_EVENT } from "./persistent-limiter.js";

/**
 * The persistent limiter (#322, ADR-020 §2, §3, §9): the service budget and per-identity daily
 * shares, counted in a store shared by every container, failing open when the store fails.
 */

const AT = new Date("2026-10-05T12:00:00.000Z");
const NEXT_MIDNIGHT = "2026-10-06T00:00:00.000Z";

const CONFIG: LimitsConfig = {
  serviceDaily: { bls: 5 },
  network: { upstreamDaily: 3, toolCallsDaily: 2 },
  pool: { upstreamDaily: 4, toolCallsDaily: 3 },
};

function caller(over: Partial<Caller> = {}): Caller {
  return { key: "net-key-a", kind: "network", labels: {}, bypass: false, ...over };
}

/** A store that records every write, so tests can prove when none happened. */
class CountingStore extends MemoryCounterStore {
  increments = 0;
  override async increment(pk: string, by: number, expiresAt: Date, max?: number) {
    this.increments += 1;
    return super.increment(pk, by, expiresAt, max);
  }
}

/** A store whose every call throws: DynamoDB is down. */
const BROKEN: CounterStore = {
  increment: async () => {
    throw new Error("ProvisionedThroughputExceededException");
  },
  get: async () => {
    throw new Error("ProvisionedThroughputExceededException");
  },
};

async function refusal(promise: Promise<unknown>): Promise<LimitExceededError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LimitExceededError) return error;
    throw error;
  }
  throw new Error("expected a LimitExceededError");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemoryCounterStore", () => {
  it("increments atomically, refuses past max without writing, and reads back", async () => {
    const store = new MemoryCounterStore();
    const exp = new Date(AT.getTime() + 86_400_000);
    expect(await store.increment("k", 1, exp, 2)).toEqual({ value: 1, applied: true });
    expect(await store.increment("k", 1, exp, 2)).toEqual({ value: 2, applied: true });
    expect(await store.increment("k", 1, exp, 2)).toEqual({ value: 2, applied: false });
    expect(await store.get("k")).toBe(2);
    expect(await store.get("missing")).toBe(0);
  });
});

describe("createLimiter: beginToolCall", () => {
  it("applies no share without a caller (stdio, local, unattested)", async () => {
    const store = new CountingStore();
    const limiter = createLimiter({ config: CONFIG, store });
    for (let i = 0; i < 10; i++) await limiter.beginToolCall(undefined, AT);
    expect(store.increments).toBe(0);
  });

  it("refuses the call past the network's toolCallsDaily, with the facts", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    await limiter.beginToolCall(caller(), AT);
    await limiter.beginToolCall(caller(), AT);
    const error = await refusal(limiter.beginToolCall(caller(), AT));
    expect(error.info).toEqual({
      scope: "network",
      kind: "toolCalls",
      limit: 2,
      used: 2,
      resetsAt: NEXT_MIDNIGHT,
    });
  });

  it("skips the share for the operator bypass", async () => {
    const store = new CountingStore();
    const limiter = createLimiter({ config: CONFIG, store });
    for (let i = 0; i < 5; i++) await limiter.beginToolCall(caller({ bypass: true }), AT);
    expect(store.increments).toBe(0);
  });

  it("keeps the pool and a network separate, each with its own limit", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    const pool = caller({ kind: "pool", key: "claude-ai" });
    for (let i = 0; i < 3; i++) await limiter.beginToolCall(pool, AT);
    const error = await refusal(limiter.beginToolCall(pool, AT));
    expect(error.info).toMatchObject({ scope: "pool", limit: 3 });
    // The network's share is untouched by the pool's use.
    await limiter.beginToolCall(caller(), AT);
    await limiter.beginToolCall(caller(), AT);
  });

  it("keeps two networks separate", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    await limiter.beginToolCall(caller(), AT);
    await limiter.beginToolCall(caller(), AT);
    await limiter.beginToolCall(caller({ key: "net-key-b" }), AT);
  });

  it("rolls over at UTC midnight", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    await limiter.beginToolCall(caller(), AT);
    await limiter.beginToolCall(caller(), AT);
    await refusal(limiter.beginToolCall(caller(), new Date("2026-10-05T23:59:59.000Z")));
    await limiter.beginToolCall(caller(), new Date("2026-10-06T00:00:00.000Z"));
  });

  it("refuses from memory, with no write, once a key is known to be over", async () => {
    const store = new CountingStore();
    const limiter = createLimiter({ config: CONFIG, store });
    await limiter.beginToolCall(caller(), AT);
    await limiter.beginToolCall(caller(), AT);
    await refusal(limiter.beginToolCall(caller(), AT));
    const writes = store.increments;
    const again = await refusal(limiter.beginToolCall(caller(), AT));
    expect(again.info.used).toBe(2);
    expect(store.increments).toBe(writes);
  });

  it("applies no share when the config has none for the caller's kind", async () => {
    const store = new CountingStore();
    const limiter = createLimiter({ config: { serviceDaily: { bls: 5 } }, store });
    await limiter.beginToolCall(caller(), AT);
    expect(store.increments).toBe(0);
  });
});

describe("createLimiter: beforeUpstream", () => {
  it("charges the service budget and returns its snapshot", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    expect(await limiter.beforeUpstream("bls", undefined, AT)).toEqual({
      source: "bls",
      used: 1,
      limit: 5,
      resetsAt: NEXT_MIDNIGHT,
    });
    expect(await limiter.usage("bls", AT)).toMatchObject({ used: 1, limit: 5 });
  });

  it("returns undefined for a source with no service budget, but still charges the share", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    for (let i = 0; i < 3; i++) {
      expect(await limiter.beforeUpstream("bls-qcew", caller(), AT)).toBeUndefined();
    }
    const error = await refusal(limiter.beforeUpstream("bls-qcew", caller(), AT));
    expect(error.info).toMatchObject({ scope: "network", kind: "upstream", source: "bls-qcew" });
    expect(await limiter.usage("bls-qcew", AT)).toBeUndefined();
  });

  it("refuses past the service budget, with scope service", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    for (let i = 0; i < 5; i++) await limiter.beforeUpstream("bls", undefined, AT);
    const error = await refusal(limiter.beforeUpstream("bls", undefined, AT));
    expect(error.info).toEqual({
      scope: "service",
      kind: "upstream",
      source: "bls",
      limit: 5,
      used: 5,
      resetsAt: NEXT_MIDNIGHT,
    });
  });

  it("refuses past the caller's upstream share", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    for (let i = 0; i < 3; i++) await limiter.beforeUpstream("bls", caller(), AT);
    const error = await refusal(limiter.beforeUpstream("bls", caller(), AT));
    expect(error.info).toMatchObject({ scope: "network", kind: "upstream", limit: 3, used: 3 });
  });

  it("lets the bypass skip the share but not the service budget", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    const op = caller({ bypass: true });
    for (let i = 0; i < 5; i++) await limiter.beforeUpstream("bls", op, AT);
    const error = await refusal(limiter.beforeUpstream("bls", op, AT));
    expect(error.info.scope).toBe("service");
  });

  it("holds one service budget across two containers sharing a store", async () => {
    const store = new MemoryCounterStore();
    const a = createLimiter({ config: CONFIG, store });
    const b = createLimiter({ config: CONFIG, store });
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 === 0 ? a : b).beforeUpstream("bls", undefined, AT),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(await store.get("svc#bls#2026-10-05")).toBe(5);
  });

  it("uses the documented key shapes", async () => {
    const store = new MemoryCounterStore();
    const limiter = createLimiter({ config: CONFIG, store });
    await limiter.beginToolCall(caller({ kind: "pool", key: "claude-ai" }), AT);
    await limiter.beforeUpstream("bls", caller(), AT);
    expect(await store.get("svc#bls#2026-10-05")).toBe(1);
    expect(await store.get("network#upstream#bls#net-key-a#2026-10-05")).toBe(1);
    expect(await store.get("pool#toolCalls#*#claude-ai#2026-10-05")).toBe(1);
  });

  it("sets each counter to expire two days after its day", async () => {
    const seen: Date[] = [];
    const inner = new MemoryCounterStore();
    const store: CounterStore = {
      increment: (pk, by, expiresAt, max) => {
        seen.push(expiresAt);
        return inner.increment(pk, by, expiresAt, max);
      },
      get: (pk) => inner.get(pk),
    };
    await createLimiter({ config: CONFIG, store }).beforeUpstream("bls", undefined, AT);
    expect(seen[0]?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
});

describe("createLimiter: a refused caller never drains the service budget", () => {
  const ROOMY: LimitsConfig = { serviceDaily: { bls: 100 }, network: { upstreamDaily: 3 } };
  const SVC = "svc#bls#2026-10-05";
  const SHARE = "network#upstream#bls#net-key-a#2026-10-05";

  it("within one limiter: attempts past the share leave the service count unchanged", async () => {
    const store = new MemoryCounterStore();
    const limiter = createLimiter({ config: ROOMY, store });
    for (let i = 0; i < 3; i++) await limiter.beforeUpstream("bls", caller(), AT);
    expect(await store.get(SVC)).toBe(3);
    for (let i = 0; i < 10; i++) {
      const error = await refusal(limiter.beforeUpstream("bls", caller(), AT));
      expect(error.info.scope).toBe("network");
    }
    expect(await store.get(SVC)).toBe(3);
  });

  it("across two containers: the store's refusal of the share spends no service unit", async () => {
    const store = new MemoryCounterStore();
    const a = createLimiter({ config: ROOMY, store });
    for (let i = 0; i < 3; i++) await a.beforeUpstream("bls", caller(), AT);
    // Each fresh container learns of the spent share only from the store's conditional refusal.
    for (let i = 0; i < 5; i++) {
      const b = createLimiter({ config: ROOMY, store });
      await refusal(b.beforeUpstream("bls", caller(), AT));
    }
    expect(await store.get(SVC)).toBe(3);
    expect(await store.get(SHARE)).toBe(3);
  });

  it("refuses from memory, charging no share, once the service budget is known to be over", async () => {
    const store = new MemoryCounterStore();
    const limiter = createLimiter({
      config: { serviceDaily: { bls: 2 }, network: { upstreamDaily: 10 } },
      store,
    });
    await limiter.beforeUpstream("bls", undefined, AT);
    await limiter.beforeUpstream("bls", undefined, AT);
    await refusal(limiter.beforeUpstream("bls", undefined, AT));
    const error = await refusal(limiter.beforeUpstream("bls", caller(), AT));
    expect(error.info.scope).toBe("service");
    expect(await store.get(SHARE)).toBe(0);
  });

  it("a bypass caller still charges the service budget", async () => {
    const store = new MemoryCounterStore();
    const limiter = createLimiter({ config: ROOMY, store });
    for (let i = 0; i < 5; i++) await limiter.beforeUpstream("bls", caller({ bypass: true }), AT);
    expect(await store.get(SVC)).toBe(5);
    expect(await store.get(SHARE)).toBe(0);
  });
});

describe("createLimiter: a failing store (ADR-020 §3)", () => {
  it("fails open on shares, falls back to an in-memory service budget, and signals degraded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limiter = createLimiter({ config: CONFIG, store: BROKEN, now: () => AT });
    // Shares: open, far past the limits.
    for (let i = 0; i < 10; i++) await limiter.beginToolCall(caller(), AT);
    // Service: the per-container count still refuses past 5.
    for (let i = 0; i < 5; i++) await limiter.beforeUpstream("bls", caller({ key: "x" }), AT);
    const error = await refusal(limiter.beforeUpstream("bls", undefined, AT));
    expect(error.info.scope).toBe("service");
    expect(await limiter.usage("bls", AT)).toMatchObject({ used: 5, limit: 5 });

    // Signalled, at most once a minute, never with the caller key.
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: LIMITER_DEGRADED_EVENT });
    expect(line).not.toContain("net-key-a");
  });

  // #326, ADR-020 §5: "make limiter_degraded countable." EMF on the existing warn line
  // (not a Logs metric filter in Terraform), because EMF needs no new IAM — the execution
  // roles already hold logs:PutLogEvents, and admin-grant-protection.sh grants rc-deploy no
  // logs:PutMetricFilter right a Terraform metric filter would need.
  it("the degraded line is also a valid EMF sample for a LimiterDegraded count (#326)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limiter = createLimiter({ config: CONFIG, store: BROKEN, now: () => AT });
    for (let i = 0; i < 5; i++) await limiter.beforeUpstream("bls", caller({ key: "x" }), AT);
    await refusal(limiter.beforeUpstream("bls", undefined, AT));

    const parsed = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(parsed._aws.CloudWatchMetrics[0]).toMatchObject({
      Namespace: "FederalMCPs",
      Metrics: [{ Name: "LimiterDegraded", Unit: "Count" }],
    });
    expect(parsed.LimiterDegraded).toBe(1);
  });

  it("signals again after a minute", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let clock = AT;
    const limiter = createLimiter({ config: CONFIG, store: BROKEN, now: () => clock });
    await limiter.beginToolCall(caller(), AT);
    await limiter.beginToolCall(caller(), AT);
    expect(warn).toHaveBeenCalledTimes(1);
    clock = new Date(AT.getTime() + 61_000);
    await limiter.beginToolCall(caller(), clock);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("the token-gated test limit (#347)", () => {
  const test = (runId: string, limit: number) => caller({ key: `test:${runId}`, testLimit: limit });

  it("refuses the (n+1)th tool call at the caller's own test limit, not the configured share", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    for (let i = 0; i < 4; i += 1) await limiter.beginToolCall(test("run-0001", 4), AT);
    const e = await refusal(limiter.beginToolCall(test("run-0001", 4), AT));
    expect(e.info).toMatchObject({ scope: "network", kind: "toolCalls", limit: 4, used: 4 });
  });

  it("counts apart from the real network share, and a new run starts fresh", async () => {
    const limiter = createLimiter({ config: CONFIG, store: new MemoryCounterStore() });
    await limiter.beginToolCall(test("run-0001", 1), AT);
    await refusal(limiter.beginToolCall(test("run-0001", 1), AT));
    // The real network (toolCallsDaily 2) is untouched by the test run.
    await limiter.beginToolCall(caller(), AT);
    await limiter.beginToolCall(caller(), AT);
    // A new run id is a new counter.
    await expect(limiter.beginToolCall(test("run-0002", 1), AT)).resolves.toBeUndefined();
  });
});

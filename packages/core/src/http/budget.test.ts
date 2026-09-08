import { describe, expect, it, vi } from "vitest";
import { MemoryBudgetStore } from "./budget.js";

describe("MemoryBudgetStore", () => {
  it("allows calls up to the daily limit and refuses the one past it", async () => {
    const store = new MemoryBudgetStore(3, () => new Date("2026-09-08T00:00:00.000Z"));
    expect((await store.consume("bls", 1)).allowed).toBe(true);
    expect((await store.consume("bls", 1)).allowed).toBe(true);
    const third = await store.consume("bls", 1);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = await store.consume("bls", 1);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("the 501st call in a day with limit 500 is refused, with a resetsAt at the next UTC midnight", async () => {
    let now = new Date("2026-09-08T10:00:00.000Z");
    const store = new MemoryBudgetStore(500, () => now);
    for (let i = 0; i < 500; i++) {
      const result = await store.consume("bls", 1);
      expect(result.allowed).toBe(true);
    }
    const result = await store.consume("bls", 1);
    expect(result.allowed).toBe(false);
    expect(result.resetsAt).toBe("2026-09-09T00:00:00.000Z");
    now = new Date("2026-09-08T23:59:59.999Z");
    const stillRefused = await store.consume("bls", 1);
    expect(stillRefused.allowed).toBe(false);
  });

  it("resets the counter at UTC midnight", async () => {
    let now = new Date("2026-09-08T23:59:59.999Z");
    const store = new MemoryBudgetStore(1, () => now);
    expect((await store.consume("bls", 1)).allowed).toBe(true);
    expect((await store.consume("bls", 1)).allowed).toBe(false);
    now = new Date("2026-09-09T00:00:00.000Z");
    const afterMidnight = await store.consume("bls", 1);
    expect(afterMidnight.allowed).toBe(true);
  });

  it("keeps per-source counters independent", async () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    const store = new MemoryBudgetStore(1, () => now);
    expect((await store.consume("bls", 1)).allowed).toBe(true);
    expect((await store.consume("bls", 1)).allowed).toBe(false);
    expect((await store.consume("census", 1)).allowed).toBe(true);
  });

  it("supports vi.useFakeTimers for the default now()", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T00:00:00.000Z"));
    const store = new MemoryBudgetStore(1);
    expect((await store.consume("bls", 1)).allowed).toBe(true);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect((await store.consume("bls", 1)).allowed).toBe(true);
    vi.useRealTimers();
  });
});

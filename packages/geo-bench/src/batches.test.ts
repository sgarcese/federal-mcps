import { describe, expect, it } from "vitest";
import type { BenchItem } from "./benchmark.js";
import { loadBenchmark } from "./benchmark.js";
import { makeBatches, renderBatch, seededShuffle } from "./batches.js";

const items = (): BenchItem[] => loadBenchmark().items;

describe("makeBatches", () => {
  it("is reproducible: the same seed yields the same order", () => {
    const a = makeBatches(items(), 7, 42)
      .flat()
      .map((i) => i.id);
    const b = makeBatches(items(), 7, 42)
      .flat()
      .map((i) => i.id);
    expect(a).toEqual(b);
  });

  it("a different seed yields a different order", () => {
    const a = makeBatches(items(), 7, 1)
      .flat()
      .map((i) => i.id);
    const b = makeBatches(items(), 7, 2)
      .flat()
      .map((i) => i.id);
    expect(a).not.toEqual(b);
  });

  it("partitions every item exactly once across batches", () => {
    const batches = makeBatches(items(), 7);
    const ids = batches
      .flat()
      .map((i) => i.id)
      .sort();
    const expected = items()
      .map((i) => i.id)
      .sort();
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(expected.length);
  });

  it("respects the batch size (last batch may be smaller)", () => {
    const batches = makeBatches(items(), 7);
    for (const b of batches.slice(0, -1)) expect(b.length).toBe(7);
    expect(batches.at(-1)?.length).toBeGreaterThan(0);
  });

  it("shuffle does not drop or duplicate", () => {
    const shuffled = seededShuffle(items(), 99);
    expect(shuffled.map((i) => i.id).sort()).toEqual(
      items()
        .map((i) => i.id)
        .sort(),
    );
  });

  it("renders a batch as [id] question lines", () => {
    const text = renderBatch(items().slice(0, 2));
    expect(text).toMatch(/^\[[A-Z]\d\d\] /);
    expect(text.split("\n\n").length).toBe(2);
  });
});

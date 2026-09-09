import type { BenchItem } from "./benchmark.js";

/**
 * The default seed (from the imported harness) so a run is reproducible. Batches are
 * seeded and shuffled so items from the same category do not cluster within a batch —
 * clustered traps prime the model being evaluated and inflate its score (harness.py).
 * The TS port uses its own PRNG, so the exact order differs from the Python harness; what
 * matters is that the same seed always yields the same order.
 */
export const DEFAULT_SEED = 20260809;
export const DEFAULT_BATCH_SIZE = 7;

/** mulberry32: a tiny, fast, deterministic PRNG. Same seed → same stream, everywhere. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle of a copy of `items`, driven by `seed`. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const oi = out[i] as T;
    out[i] = out[j] as T;
    out[j] = oi;
  }
  return out;
}

/** Shuffle then slice into batches of `size`, reproducibly (harness.py `make_batches`). */
export function makeBatches(
  items: readonly BenchItem[],
  size: number = DEFAULT_BATCH_SIZE,
  seed: number = DEFAULT_SEED,
): BenchItem[][] {
  const shuffled = seededShuffle(items, seed);
  const batches: BenchItem[][] = [];
  for (let i = 0; i < shuffled.length; i += size) batches.push(shuffled.slice(i, i + size));
  return batches;
}

/** Render a batch as the prompt the model sees (harness.py `render_batch`). */
export function renderBatch(batch: readonly BenchItem[]): string {
  return batch.map((it) => `[${it.id}] ${it.question}`).join("\n\n");
}

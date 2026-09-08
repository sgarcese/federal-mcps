import { describe, expect, it } from "vitest";
import { CACHE_MISS, CacheInfoSchema } from "./cache.js";

describe("CacheInfo seam", () => {
  it("accepts a miss, a fresh hit and a stale hit", () => {
    expect(CacheInfoSchema.parse({ hit: false })).toEqual({ hit: false });
    expect(CacheInfoSchema.parse({ hit: true, ageSeconds: 42 })).toEqual({
      hit: true,
      ageSeconds: 42,
    });
    expect(CacheInfoSchema.parse({ hit: true, ageSeconds: 90_000, stale: true }).stale).toBe(true);
  });

  it("rejects negative or fractional ages", () => {
    expect(CacheInfoSchema.safeParse({ hit: true, ageSeconds: -1 }).success).toBe(false);
    expect(CacheInfoSchema.safeParse({ hit: true, ageSeconds: 1.5 }).success).toBe(false);
  });

  it("CACHE_MISS is a frozen miss", () => {
    expect(CACHE_MISS).toEqual({ hit: false });
    expect(Object.isFrozen(CACHE_MISS)).toBe(true);
  });
});

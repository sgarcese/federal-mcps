import { describe, expect, it } from "vitest";
import { MemoryCacheStore, cacheKey } from "./cache-store.js";

describe("cacheKey", () => {
  it("is a sha256 hex digest", () => {
    const key = cacheKey("GET", "https://api.bls.gov/x");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable regardless of header insertion order", () => {
    const a = cacheKey("GET", "https://api.bls.gov/x", {
      Accept: "application/json",
      "X-Api-Key": "k",
    });
    const b = cacheKey("GET", "https://api.bls.gov/x", {
      "X-Api-Key": "k",
      Accept: "application/json",
    });
    expect(a).toBe(b);
  });

  it("differs by method, url or header value", () => {
    const base = cacheKey("GET", "https://api.bls.gov/x", { Accept: "application/json" });
    expect(cacheKey("POST", "https://api.bls.gov/x", { Accept: "application/json" })).not.toBe(
      base,
    );
    expect(cacheKey("GET", "https://api.bls.gov/y", { Accept: "application/json" })).not.toBe(base);
    expect(cacheKey("GET", "https://api.bls.gov/x", { Accept: "text/plain" })).not.toBe(base);
  });
});

describe("MemoryCacheStore", () => {
  it("returns undefined for a miss and the stored entry after a set", async () => {
    const store = new MemoryCacheStore();
    expect(await store.get("k")).toBeUndefined();
    const entry = { value: { n: 1 }, status: 200, storedAt: 1000 };
    await store.set("k", entry);
    expect(await store.get("k")).toEqual(entry);
  });
});

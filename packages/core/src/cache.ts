import { z } from "zod";

/**
 * Cache provenance attached to every response.
 *
 * This is the seam between the HTTP client (#5), which produces it, and the
 * provenance envelope (#4), which carries it to the caller. Both import from
 * here; neither redefines it.
 *
 * - `hit`        the value came from cache (fresh or stale) rather than the agency.
 * - `ageSeconds` how old the cached value is; absent on a miss.
 * - `stale`      the value is past its fresh TTL and was served because the agency
 *                call failed or was skipped (two-tier cache, ADR-002 §5 / issue #5).
 */
export const CacheInfoSchema = z.object({
  hit: z.boolean(),
  ageSeconds: z.number().int().nonnegative().optional(),
  stale: z.boolean().optional(),
});

export type CacheInfo = z.infer<typeof CacheInfoSchema>;

/** The `cache` block for a response that came straight from the agency. */
export const CACHE_MISS: Readonly<CacheInfo> = Object.freeze({ hit: false });

import { z } from "zod";

/**
 * The per-server limits configuration (ADR-020 §7): written by Terraform from the fleet record's
 * `limits` block into one `FEDERAL_MCPS_LIMITS` JSON environment variable, read once per container.
 * No variable means no limiter, as for stdio, local and self-hosted runs.
 *
 * - `serviceDaily`: daily upstream queries for the whole service, per upstream budget key (e.g.
 *   `{ bls: 490 }`), shared across containers through the persistent store.
 * - `network` / `pool`: per-identity daily shares, for one network (a hashed source address) and for
 *   the claude.ai pool: `upstreamDaily` queries and `toolCallsDaily` calls.
 * - `upstreamPerMinute` / `upstreamErrorsPerMinute`: an agency's per-minute quotas before the split
 *   by `reservedConcurrency` (e.g. HUD 60 ÷ 2 = 30 per container).
 */
const count = z.number().int().nonnegative();
const share = z
  .object({ upstreamDaily: count.optional(), toolCallsDaily: count.optional() })
  .strict();

export const LimitsConfigSchema = z
  .object({
    serviceDaily: z.record(z.string(), count).optional(),
    network: share.optional(),
    pool: share.optional(),
    upstreamPerMinute: z.record(z.string(), count).optional(),
    upstreamErrorsPerMinute: z.record(z.string(), count).optional(),
    reservedConcurrency: z.number().int().positive().optional(),
  })
  .strict();

export type LimitsConfig = z.infer<typeof LimitsConfigSchema>;

/** The environment variable that carries the configuration. */
export const LIMITS_ENV = "FEDERAL_MCPS_LIMITS";

/**
 * Parses `FEDERAL_MCPS_LIMITS`. Undefined or empty means no limiter; a malformed value throws at
 * cold start, so a misconfigured deploy fails loudly rather than running unprotected.
 */
export function parseLimitsConfig(raw: string | undefined): LimitsConfig | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${LIMITS_ENV} is not valid JSON`);
  }
  const parsed = LimitsConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${LIMITS_ENV} is malformed: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return parsed.data;
}

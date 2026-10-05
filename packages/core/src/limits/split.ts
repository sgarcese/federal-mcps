import type { LimitsConfig } from "./config.js";

/**
 * Splits an agency's published per-minute quota (or error budget) across the containers each
 * reserves concurrency for (ADR-020 §2, §7): `FEDERAL_MCPS_LIMITS` carries the agency's *total*
 * published rate (e.g. HUD User's 60 queries/minute/token, BEA's 90 requests/minute and 30
 * errors/minute) plus `reservedConcurrency`, the number of containers that share one token —
 * each container's own client gets `floor(total / reservedConcurrency)`, so the fleet never
 * exceeds the agency's limit even though every container enforces its own slice locally.
 *
 * Returns `fallback` (today's hard-coded constant) whenever `FEDERAL_MCPS_LIMITS` is unset, or
 * set but missing either this source's entry in `table` or `reservedConcurrency` — so a
 * misconfigured deploy degrades to the old single-container behaviour rather than dividing by
 * nothing. The floor is never less than 1, so a pathological split never fully blocks a server.
 *
 * Example: HUD 60 ÷ 2 = 30; BEA 90 ÷ 2 = 45; BEA's error budget 30 ÷ 2 = 15.
 */
export function splitUpstreamPerMinute(
  limits: LimitsConfig | undefined,
  table: "upstreamPerMinute" | "upstreamErrorsPerMinute",
  source: string,
  fallback: number,
): number {
  if (limits === undefined) return fallback;
  const total = limits[table]?.[source];
  const reservedConcurrency = limits.reservedConcurrency;
  if (total === undefined || reservedConcurrency === undefined) return fallback;
  return Math.max(1, Math.floor(total / reservedConcurrency));
}

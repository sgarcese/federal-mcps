import type { Caller } from "../server/caller.js";

/**
 * The limiter seam (ADR-020 §2–§4), shared by the persistent limiter (#322) and the refusal shape
 * (#323). The limiter decides; the shell and the HTTP client ask it; the refusal renders its facts.
 */

/** Whose share was spent: one network, the claude.ai pool, or the whole service. */
export type LimitScope = "network" | "pool" | "service";

/** The facts a refusal (and the envelope's `limit` block) carries. */
export interface LimitInfo {
  readonly scope: LimitScope;
  /** Upstream queries to an agency, or tool calls to this server. */
  readonly kind: "upstream" | "toolCalls";
  /** The upstream budget key (e.g. "bls"), for `kind: "upstream"`. */
  readonly source?: string;
  readonly limit: number;
  readonly used: number;
  /** ISO time the share resets (UTC midnight for daily shares). */
  readonly resetsAt: string;
}

/** Thrown when a call would exceed a share or the service budget. */
export class LimitExceededError extends Error {
  readonly info: LimitInfo;
  constructor(info: LimitInfo) {
    const what = info.kind === "upstream" ? `${info.source ?? "upstream"} queries` : "tool calls";
    super(`${info.scope} limit of ${info.limit} ${what} reached; resets at ${info.resetsAt}`);
    this.name = "LimitExceededError";
    this.info = info;
  }
}

/** Today's use of a service budget, for `describe_source` and the 80% warning. */
export interface UsageSnapshot {
  readonly source: string;
  readonly used: number;
  readonly limit: number;
  readonly resetsAt: string;
}

export interface Limiter {
  /** Counts one tool call for the caller; throws `LimitExceededError` past its share. */
  beginToolCall(caller: Caller | undefined, at: Date): Promise<void>;
  /**
   * Counts one upstream query to `source` against the service budget and the caller's share;
   * throws `LimitExceededError` when either is spent. Returns the service budget's use after the
   * count (undefined when `source` has no service budget), so the caller can warn past 80%.
   */
  beforeUpstream(
    source: string,
    caller: Caller | undefined,
    at: Date,
  ): Promise<UsageSnapshot | undefined>;
  /** The service budget's use today, without counting (undefined when there is none). */
  usage(source: string, at: Date): Promise<UsageSnapshot | undefined>;
}

/** No limits: stdio, local and self-hosted runs without `FEDERAL_MCPS_LIMITS`. */
export const NO_LIMITER: Limiter = {
  beginToolCall: async () => undefined,
  beforeUpstream: async () => undefined,
  usage: async () => undefined,
};

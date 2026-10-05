import type { Caller } from "../server/caller.js";
import type { LimitsConfig } from "./config.js";
import { type CounterStore, MemoryCounterStore } from "./counter-store.js";
import {
  LimitExceededError,
  type Limiter,
  type LimitInfo,
  type LimitScope,
  type UsageSnapshot,
} from "./limiter.js";

/**
 * The persistent limiter (#322, ADR-020 §2, §3, §9): daily counters, in a store every container
 * shares, for the service budget and for per-identity shares.
 *
 * Keys (one counter each, UTC days, expiring two days after their day):
 * - `svc#<source>#<day>`: the service budget, `config.serviceDaily[source]`;
 * - `<scope>#<kind>#<source|*>#<caller.key>#<day>`: a caller's share, scope `network` or `pool`,
 *   kind `upstream` (per source) or `toolCalls` (`*`), limits from `config.network` / `config.pool`.
 *
 * Once a key is known to be over its limit, it is refused from memory with no write (per
 * container). If the store fails, shares fail open, the service budget falls back to an in-memory
 * per-container count, and a `limiter_degraded` line is logged at most once a minute (ADR-020 §3).
 */

/** The stable marker on the degraded-store log line, which the metrics (#326) count. */
export const LIMITER_DEGRADED_EVENT = "limiter_degraded";

export interface CreateLimiterOptions {
  readonly config: LimitsConfig;
  readonly store: CounterStore;
  /** Clock for the degraded-log throttle; tests inject it. */
  readonly now?: () => Date;
}

const DAY_MS = 86_400_000;
const DEGRADED_LOG_INTERVAL_MS = 60_000;
/** Counters live two days after their day ends (ADR-020 §1: kept at most two days). */
const RETAIN_DAYS = 2;

interface Counted {
  readonly key: string;
  readonly limit: number;
  readonly info: Omit<LimitInfo, "used">;
}

export function createLimiter(options: CreateLimiterOptions): Limiter {
  const { config, store } = options;
  const now = options.now ?? (() => new Date());
  /** Keys known to be over their limit, with the count seen; the day in the key retires them. */
  const over = new Map<string, number>();
  /** The service budget's per-container fallback while the store is down. */
  const fallback = new MemoryCounterStore(now);
  let lastDegradedLogMs = Number.NEGATIVE_INFINITY;

  function degraded(operation: string, error: unknown): void {
    const at = now().getTime();
    if (at - lastDegradedLogMs < DEGRADED_LOG_INTERVAL_MS) return;
    lastDegradedLogMs = at;
    // No key, caller or address: only what failed and the error's name.
    console.warn(
      JSON.stringify({
        event: LIMITER_DEGRADED_EVENT,
        operation,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }

  /**
   * Counts one against `counted`; throws `LimitExceededError` past its limit. A store failure
   * returns the fallback's count for the service budget and lets a share through.
   */
  function refuseIfKnownOver(counted: Counted | undefined): void {
    if (counted === undefined) return;
    const known = over.get(counted.key);
    if (known !== undefined) throw new LimitExceededError({ ...counted.info, used: known });
  }

  async function charge(counted: Counted, at: Date): Promise<number> {
    refuseIfKnownOver(counted);
    const expiresAt = new Date(dayStart(at) + (1 + RETAIN_DAYS) * DAY_MS);
    let result: { value: number; applied: boolean };
    try {
      result = await store.increment(counted.key, 1, expiresAt, counted.limit);
    } catch (error) {
      degraded(counted.info.scope === "service" ? "service" : "share", error);
      if (counted.info.scope !== "service") return 0;
      result = await fallback.increment(counted.key, 1, expiresAt, counted.limit);
    }
    if (!result.applied) {
      over.set(counted.key, result.value);
      throw new LimitExceededError({ ...counted.info, used: result.value });
    }
    return result.value;
  }

  function serviceCounted(source: string, at: Date): Counted | undefined {
    const limit = config.serviceDaily?.[source];
    if (limit === undefined) return undefined;
    return {
      key: `svc#${source}#${dayKey(at)}`,
      limit,
      info: { scope: "service", kind: "upstream", source, limit, resetsAt: resetsAt(at) },
    };
  }

  function shareCounted(
    caller: Caller | undefined,
    kind: "upstream" | "toolCalls",
    source: string | undefined,
    at: Date,
  ): Counted | undefined {
    if (caller === undefined || caller.bypass) return undefined;
    const scope: LimitScope = caller.kind;
    const share = scope === "pool" ? config.pool : config.network;
    const limit = kind === "upstream" ? share?.upstreamDaily : share?.toolCallsDaily;
    if (limit === undefined) return undefined;
    return {
      key: `${scope}#${kind}#${source ?? "*"}#${caller.key}#${dayKey(at)}`,
      limit,
      info: {
        scope,
        kind,
        ...(source === undefined ? {} : { source }),
        limit,
        resetsAt: resetsAt(at),
      },
    };
  }

  return {
    // One key only (the caller's tool-call share), so there is no charge order to get wrong; if
    // this ever charges a second key, pre-check both from memory and charge the caller's first,
    // as beforeUpstream does.
    async beginToolCall(caller, at) {
      const share = shareCounted(caller, "toolCalls", undefined, at);
      if (share !== undefined) await charge(share, at);
    },

    async beforeUpstream(source, caller, at) {
      const service = serviceCounted(source, at);
      const share = shareCounted(caller, "upstream", source, at);
      // 1. Refuse from memory, before any write, when either key is already known to be over.
      refuseIfKnownOver(share);
      refuseIfKnownOver(service);
      // 2. The caller's own share first, so a caller refused its share never spends the shared
      //    service budget: a script looping on refusals cannot drain it for everyone.
      if (share !== undefined) await charge(share, at);
      // 3. Then the service budget. If it refuses here, the share has lost one unit; that costs
      //    only this caller, which is acceptable.
      if (service === undefined) return undefined;
      return snapshot(service, await charge(service, at));
    },

    async usage(source, at) {
      const service = serviceCounted(source, at);
      if (service === undefined) return undefined;
      let used: number;
      try {
        used = await store.get(service.key);
      } catch (error) {
        degraded("usage", error);
        used = await fallback.get(service.key);
      }
      return snapshot(service, used);
    },
  };
}

function snapshot(service: Counted, used: number): UsageSnapshot {
  return {
    source: service.info.source ?? "",
    used,
    limit: service.limit,
    resetsAt: service.info.resetsAt,
  };
}

function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function dayStart(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

function resetsAt(at: Date): string {
  return new Date(dayStart(at) + DAY_MS).toISOString();
}

import { LIMITS_ENV, parseLimitsConfig } from "./config.js";
import { type CounterStore, MemoryCounterStore } from "./counter-store.js";
import { DynamoCounterStore } from "./dynamo-store.js";
import { type Limiter, NO_LIMITER } from "./limiter.js";
import { createLimiter } from "./persistent-limiter.js";

/**
 * Builds a server's limiter from its environment, once per container (#322, ADR-020 §7):
 * - `FEDERAL_MCPS_LIMITS` and `FEDERAL_MCPS_LIMITS_TABLE` both set: the DynamoDB store, shared by
 *   every container;
 * - the config without a table: an in-memory store per container, with one warning;
 * - no config (stdio, local, self-hosted without limits): `NO_LIMITER`.
 * A malformed config throws, so a misconfigured deploy fails at cold start.
 */

/** The environment variable naming the counter table (Terraform: `rc-federal-mcps-<env>-limits`). */
export const LIMITS_TABLE_ENV = "FEDERAL_MCPS_LIMITS_TABLE";

export interface LimiterFromEnvOptions {
  /** Observes the store chosen; for tests. */
  readonly onStore?: (store: CounterStore) => void;
}

let warnedNoTable = false;

export function limiterFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: LimiterFromEnvOptions = {},
): Limiter {
  const config = parseLimitsConfig(env[LIMITS_ENV]);
  if (config === undefined) return NO_LIMITER;
  const tableName = env[LIMITS_TABLE_ENV]?.trim();
  let store: CounterStore;
  if (tableName) {
    store = new DynamoCounterStore({ tableName });
  } else {
    if (!warnedNoTable) {
      warnedNoTable = true;
      console.warn(
        `${LIMITS_ENV} is set but ${LIMITS_TABLE_ENV} is not; limits are counted per container, in memory.`,
      );
    }
    store = new MemoryCounterStore();
  }
  options.onStore?.(store);
  return createLimiter({ config, store });
}

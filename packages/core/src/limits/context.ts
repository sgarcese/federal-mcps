import { AsyncLocalStorage } from "node:async_hooks";
import type { Caller } from "../server/caller.js";

/**
 * The per-call context (ADR-020 seam): the shell runs each tool call inside one, so code far from
 * the handler (the HTTP client charging an upstream query to the caller, #322) can read the caller,
 * and can leave notes — e.g. the 80% budget warning (#323) — that the shell adds to the answer's
 * limitations.
 */
export interface CallContext {
  readonly caller?: Caller;
  /** Limitations to add to this call's answer, in order. */
  readonly notes: string[];
  /**
   * How many real upstream fetches this call has made so far (#326, ADR-020 §5): a mutable
   * box rather than a plain number, so `incrementUpstreamCalls` (the HTTP client, on each
   * real fetch — never a cache hit or a replayed fixture) can bump it without threading a
   * new context back out to the shell. Read by the per-call metrics log line.
   */
  readonly upstreamCalls: { count: number };
}

const storage = new AsyncLocalStorage<CallContext>();

/** Runs `fn` inside a fresh call context. */
export function runInCall<T>(init: { caller?: Caller }, fn: () => Promise<T>): Promise<T> {
  const context: CallContext = {
    ...(init.caller === undefined ? {} : { caller: init.caller }),
    notes: [],
    upstreamCalls: { count: 0 },
  };
  return storage.run(context, fn);
}

/** The current call's context, or undefined outside a tool call. */
export function currentCall(): CallContext | undefined {
  return storage.getStore();
}

/** Counts one real upstream fetch against the current call, if there is one (http/client.ts). */
export function incrementUpstreamCalls(): void {
  const context = storage.getStore();
  if (context !== undefined) context.upstreamCalls.count += 1;
}

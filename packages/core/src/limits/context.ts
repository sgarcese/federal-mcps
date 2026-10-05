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
}

const storage = new AsyncLocalStorage<CallContext>();

/** Runs `fn` inside a fresh call context. */
export function runInCall<T>(init: { caller?: Caller }, fn: () => Promise<T>): Promise<T> {
  const context: CallContext = {
    ...(init.caller === undefined ? {} : { caller: init.caller }),
    notes: [],
  };
  return storage.run(context, fn);
}

/** The current call's context, or undefined outside a tool call. */
export function currentCall(): CallContext | undefined {
  return storage.getStore();
}

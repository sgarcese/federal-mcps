import { describe, expect, it } from "vitest";
import { currentCall, incrementUpstreamCalls, runInCall } from "./context.js";

/**
 * The per-call upstream-fetch counter (#326, ADR-020 §5): a mutable box on the call context
 * that `incrementUpstreamCalls` (http/client.ts, on each real fetch) bumps, and the metrics
 * log line reads after the handler returns.
 */
describe("context: upstreamCalls counter", () => {
  it("starts at zero for a fresh call", async () => {
    await runInCall({}, async () => {
      expect(currentCall()?.upstreamCalls.count).toBe(0);
    });
  });

  it("increments once per call to incrementUpstreamCalls, inside the same context", async () => {
    await runInCall({}, async () => {
      incrementUpstreamCalls();
      incrementUpstreamCalls();
      incrementUpstreamCalls();
      expect(currentCall()?.upstreamCalls.count).toBe(3);
    });
  });

  it("is a no-op outside any call context (no throw)", () => {
    expect(() => incrementUpstreamCalls()).not.toThrow();
  });

  it("isolates counts between concurrent calls (AsyncLocalStorage per call)", async () => {
    const [a, b] = await Promise.all([
      runInCall({}, async () => {
        incrementUpstreamCalls();
        await new Promise((resolve) => setTimeout(resolve, 5));
        incrementUpstreamCalls();
        return currentCall()?.upstreamCalls.count;
      }),
      runInCall({}, async () => {
        incrementUpstreamCalls();
        return currentCall()?.upstreamCalls.count;
      }),
    ]);
    expect(a).toBe(2);
    expect(b).toBe(1);
  });
});

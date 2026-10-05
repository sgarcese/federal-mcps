import { describe, expect, it } from "vitest";
import { currentCall, runInCall } from "./context.js";
import { LimitExceededError, NO_LIMITER } from "./limiter.js";

describe("LimitExceededError (ADR-020 §4 seam)", () => {
  it("carries the structured limit facts the refusal renders", () => {
    const e = new LimitExceededError({
      scope: "network",
      kind: "upstream",
      source: "bls",
      limit: 100,
      used: 100,
      resetsAt: "2026-10-06T00:00:00.000Z",
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LimitExceededError");
    expect(e.info.scope).toBe("network");
    expect(e.message).toMatch(/bls/);
  });
});

describe("NO_LIMITER", () => {
  it("never refuses and reports no usage", async () => {
    await expect(NO_LIMITER.beginToolCall(undefined, new Date())).resolves.toBeUndefined();
    await expect(NO_LIMITER.beforeUpstream("bls", undefined, new Date())).resolves.toBeUndefined();
    await expect(NO_LIMITER.usage("bls", new Date())).resolves.toBeUndefined();
  });
});

describe("the per-call context (ADR-020 §1–§4 seam)", () => {
  it("is undefined outside a call", () => {
    expect(currentCall()).toBeUndefined();
  });

  it("carries the caller through awaits and collects notes for the answer", async () => {
    const caller = { key: "k", kind: "network" as const, labels: {}, bypass: false };
    const notes = await runInCall({ caller }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentCall()?.caller).toBe(caller);
      currentCall()?.notes.push("BLS daily quota 85% used");
      return currentCall()?.notes;
    });
    expect(notes).toEqual(["BLS daily quota 85% used"]);
    expect(currentCall()).toBeUndefined();
  });

  it("keeps concurrent calls apart", async () => {
    const a = runInCall({}, async () => {
      await new Promise((r) => setTimeout(r, 5));
      currentCall()?.notes.push("a");
      return currentCall()?.notes;
    });
    const b = runInCall({}, async () => {
      currentCall()?.notes.push("b");
      return currentCall()?.notes;
    });
    expect(await a).toEqual(["a"]);
    expect(await b).toEqual(["b"]);
  });
});

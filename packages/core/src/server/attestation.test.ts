import { describe, expect, it } from "vitest";
import { ATTESTATION_HEADER, attest, isAttested } from "./attestation.js";

describe("attestation", () => {
  const real = attest()[ATTESTATION_HEADER];

  it("is a 64-hex-character per-process nonce, the same on every call", () => {
    expect(real).toMatch(/^[0-9a-f]{64}$/);
    expect(attest()[ATTESTATION_HEADER]).toBe(real);
  });

  it("accepts only the exact nonce", () => {
    expect(isAttested({ [ATTESTATION_HEADER]: real })).toBe(true);
    expect(isAttested({})).toBe(false);
    for (const wrong of ["", "forged", `${real}0`, real?.slice(0, -1), "0".repeat(64)]) {
      expect(isAttested({ [ATTESTATION_HEADER]: wrong }), String(wrong)).toBe(false);
    }
    expect(isAttested({ [ATTESTATION_HEADER]: real?.toUpperCase() })).toBe(false);
  });
});

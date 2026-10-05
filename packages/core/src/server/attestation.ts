import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * In-process attestation of the forwarded source address (#321, ADR-020 §1).
 *
 * `SOURCE_IP_HEADER` is an ordinary HTTP header, so on its own it proves nothing: anyone who can
 * reach a `createHttpHandler` directly (a self-hoster's public port, a local dev server) could
 * send one and choose their identity, rotating fake addresses to escape the per-network share or
 * claiming a `160.79.104.0/21` address to drain the claude.ai pool. Only our Lambda adapter knows
 * the real address, and it replays each request against a loopback server *in the same process*.
 * So the adapter (`lambdaRequestHeaders`) sends this process's random nonce in
 * `ATTESTATION_HEADER` beside the source header, and the shell treats the source header as
 * present only when the nonce matches. Nothing outside the process can know the nonce, and no
 * configuration is needed.
 *
 * The nonce is drawn once at module load, lives only in this module's memory, and is never
 * exported from the package, logged, or put in the environment. `attest` and `isAttested` are
 * for the adapter helper and the shell; the package index exports only the header name.
 */

/** Internal header carrying the nonce; stripped from client requests by the adapter. */
export const ATTESTATION_HEADER = "x-federal-mcps-attestation";

const NONCE = randomBytes(32).toString("hex");
const NONCE_DIGEST = digest(NONCE);

/** The attestation header and value, for `lambdaRequestHeaders` only. */
export function attest(): Readonly<Record<typeof ATTESTATION_HEADER, string>> {
  return { [ATTESTATION_HEADER]: NONCE };
}

/**
 * True only when the (lower-cased) headers carry this process's nonce. Both sides are hashed to
 * fixed-length digests and compared with `timingSafeEqual`, so neither the time taken nor a
 * length check reveals how much of a guess was right.
 */
export function isAttested(headers: Readonly<Record<string, string | undefined>>): boolean {
  const presented = headers[ATTESTATION_HEADER];
  if (presented === undefined) return false;
  return timingSafeEqual(digest(presented), NONCE_DIGEST);
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

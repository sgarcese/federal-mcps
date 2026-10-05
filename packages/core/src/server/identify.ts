import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import {
  type Caller,
  type Identify,
  OPERATOR_BYPASS_HEADER,
  type RequestHeaders,
  SOURCE_IP_HEADER,
} from "./caller.js";

/**
 * `identify()` (#321, ADR-020 §1): request headers in, a `Caller` out.
 *
 * - No forwarded source address (stdio, local runs, the loopback without the Lambda adapter)
 *   means no caller, so no per-identity limits.
 * - An address in the claude.ai range `160.79.104.0/21` is one shared **pool**: every claude.ai
 *   user arrives from it, so it gets one capped share rather than one share per address.
 * - Any other address is a **network**, keyed by HMAC-SHA256(secret, utcDay + "|" + network),
 *   hex, truncated to `CALLER_KEY_HEX_LENGTH`. The key rotates at UTC midnight, so a stored
 *   counter can only be linked to an address on the day it was written, and only by someone
 *   holding the secret. The raw address is never stored on the Caller, logged or returned.
 *
 * x-forwarded-for is never read: a client can write any value into it.
 */

/** HMAC secret for network keys; a sensitive deploy variable. */
export const CALLER_SECRET_ENV = "FEDERAL_MCPS_CALLER_SECRET";
/** Expected value of `OPERATOR_BYPASS_HEADER`; a sensitive deploy variable. */
export const OPERATOR_TOKEN_ENV = "FEDERAL_MCPS_OPERATOR_TOKEN";

/** The pool's fixed key. Not personal data: it names a range shared by every claude.ai user. */
export const CLAUDE_AI_POOL_KEY = "claude-ai";
/** The claude.ai egress range (ADR-020 §1). */
export const CLAUDE_AI_POOL_CIDR = "160.79.104.0/21";

/**
 * Hex characters kept from the HMAC: 32 (128 bits). Collisions between the networks seen in one
 * day are negligible at that length, and the key stays short enough for a DynamoDB `pk`.
 */
export const CALLER_KEY_HEX_LENGTH = 32;

/** Longest metric label kept (User-Agent); labels are never enforcement keys. */
export const LABEL_MAX_LENGTH = 128;

export interface IdentifyOptions {
  /** HMAC secret. Unset or empty: `identify` always returns undefined (no per-identity limits). */
  readonly secret?: string | undefined;
  /** Operator-bypass token. Unset or empty: no request is ever a bypass. */
  readonly operatorToken?: string | undefined;
  /** Where the one missing-secret warning goes (default `console.warn`). */
  readonly warn?: (message: string) => void;
}

/**
 * Builds an `Identify`. A missing secret is reported once, here (at cold start when the caller
 * builds it then), and yields no callers at all: no per-identity limits is safer than keying
 * counters on unhashed addresses.
 */
export function createIdentify(options: IdentifyOptions): Identify {
  const secret = options.secret ?? "";
  const operatorToken = options.operatorToken ?? "";
  if (secret === "") {
    (options.warn ?? console.warn)(
      `${CALLER_SECRET_ENV} is not set; caller identity is off, so per-network and claude.ai pool limits do not apply.`,
    );
    return () => undefined;
  }

  return (headers: RequestHeaders, now: Date): Caller | undefined => {
    const address = headers[SOURCE_IP_HEADER]?.trim();
    if (address === undefined || address === "") return undefined;

    const network = networkOf(address);
    const labels = labelsFrom(headers);
    const bypass = tokenMatches(headers[OPERATOR_BYPASS_HEADER], operatorToken);

    if (isClaudeAiPool(network)) {
      return { kind: "pool", key: CLAUDE_AI_POOL_KEY, labels, bypass };
    }
    const day = now.toISOString().slice(0, 10);
    const key = createHmac("sha256", secret)
      .update(`${day}|${network}`)
      .digest("hex")
      .slice(0, CALLER_KEY_HEX_LENGTH);
    return { kind: "network", key, labels, bypass };
  };
}

/** `createIdentify` from `FEDERAL_MCPS_CALLER_SECRET` and `FEDERAL_MCPS_OPERATOR_TOKEN`. */
export function identifyFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  warn?: (message: string) => void,
): Identify {
  return createIdentify({
    secret: env[CALLER_SECRET_ENV],
    operatorToken: env[OPERATOR_TOKEN_ENV],
    ...(warn === undefined ? {} : { warn }),
  });
}

/**
 * The network an address stands for, normalised:
 * - IPv4, and IPv4-mapped IPv6 (`::ffff:a.b.c.d` or its hex form), as dotted IPv4;
 * - other IPv6 as its /64 (`2001:db8:1:2::/64`). One host is routinely given a whole /64 and
 *   can rotate through it freely (privacy extensions do so by default), so a narrower key would
 *   hand one machine 2^64 shares;
 * - anything unparseable, trimmed and lower-cased (it is only ever hashed).
 */
export function networkOf(address: string): string {
  const cleaned = address.trim().toLowerCase().replace(/%.*$/, "");
  if (isIPv4(cleaned)) return cleaned;
  if (!isIPv6(cleaned)) return cleaned;
  const hextets = expandIPv6(cleaned);
  if (hextets === undefined) return cleaned;
  const mapped = hextets.slice(0, 5).every((part) => part === 0) && hextets[5] === 0xffff;
  if (mapped) {
    const high = hextets[6] ?? 0;
    const low = hextets[7] ?? 0;
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${hextets
    .slice(0, 4)
    .map((part) => part.toString(16))
    .join(":")}::/64`;
}

/** True when the address (any form `networkOf` accepts) is inside `160.79.104.0/21`. */
export function isClaudeAiPool(address: string): boolean {
  const network = networkOf(address);
  if (!isIPv4(network)) return false;
  return (ipv4ToInt(network) & POOL_MASK) >>> 0 === POOL_BASE;
}

const POOL_MASK = 0xfffff800; // /21
const POOL_BASE = ipv4ToInt("160.79.104.0");

function ipv4ToInt(address: string): number {
  return (
    address
      .split(".")
      .reduce((value, octet) => ((value << 8) | Number.parseInt(octet, 10)) >>> 0, 0) >>> 0
  );
}

/** Eight 16-bit groups of a valid IPv6 address (`isIPv6` already passed), or undefined. */
function expandIPv6(address: string): number[] | undefined {
  let text = address;
  // An embedded dotted IPv4 tail (`::ffff:1.2.3.4`) becomes two hex groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1] !== undefined) {
    const value = ipv4ToInt(dotted[1]);
    text = `${text.slice(0, dotted.index)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [head = "", tail, ...rest] = text.split("::");
  if (rest.length > 0) return undefined;
  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((g) => Number.parseInt(g, 16));
  const front = parse(head);
  if (tail === undefined) return front.length === 8 ? front : undefined;
  const back = parse(tail);
  const missing = 8 - front.length - back.length;
  if (missing < 1) return undefined;
  return [...front, ...new Array<number>(missing).fill(0), ...back];
}

function labelsFrom(headers: RequestHeaders): Caller["labels"] {
  // The MCP client name is not available per request in stateless Streamable HTTP: clientInfo
  // arrives only on `initialize`, and the shared server instance would attribute the last
  // initializer's name to every caller in the container. So only the User-Agent is labelled.
  const userAgent = headers["user-agent"]?.trim();
  return userAgent ? { userAgent: userAgent.slice(0, LABEL_MAX_LENGTH) } : {};
}

/**
 * Constant-time comparison: both sides are hashed to fixed-length digests first, so neither the
 * comparison time nor an early length check reveals how much of the token was right.
 */
function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (expected === "" || presented === undefined) return false;
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { OPERATOR_BYPASS_HEADER, SOURCE_IP_HEADER } from "./caller.js";
import {
  CALLER_KEY_HEX_LENGTH,
  CALLER_SECRET_ENV,
  CLAUDE_AI_POOL_KEY,
  createIdentify,
  identifyFromEnv,
  isClaudeAiPool,
  LABEL_MAX_LENGTH,
  networkOf,
  OPERATOR_TOKEN_ENV,
} from "./identify.js";

const SECRET = "test-secret-not-real";
const TOKEN = "operator-token-not-real";
const NOON = new Date("2026-10-05T12:00:00.000Z");

function identify(options: Parameters<typeof createIdentify>[0] = {}) {
  return createIdentify({ secret: SECRET, operatorToken: TOKEN, warn: () => {}, ...options });
}

describe("identify: no forwarded address", () => {
  it("returns undefined without the source-address header (stdio, local runs)", () => {
    expect(identify()({ "user-agent": "curl/8" }, NOON)).toBeUndefined();
    expect(identify()({ [SOURCE_IP_HEADER]: "" }, NOON)).toBeUndefined();
  });

  it("never derives identity from x-forwarded-for", () => {
    expect(identify()({ "x-forwarded-for": "203.0.113.9" }, NOON)).toBeUndefined();
    const a = identify()(
      { [SOURCE_IP_HEADER]: "198.51.100.1", "x-forwarded-for": "203.0.113.9" },
      NOON,
    );
    const b = identify()({ [SOURCE_IP_HEADER]: "198.51.100.1" }, NOON);
    expect(a?.key).toBe(b?.key);
  });
});

describe("identify: the claude.ai pool (160.79.104.0/21)", () => {
  it.each([
    ["160.79.104.0", true],
    ["160.79.111.255", true],
    ["160.79.107.42", true],
    ["160.79.112.0", false],
    ["160.79.103.255", false],
    ["::ffff:160.79.104.0", true],
    ["::ffff:160.79.111.255", true],
    ["::ffff:160.79.112.0", false],
    ["::ffff:a04f:6801", true],
    ["2001:db8::1", false],
  ])("%s in pool: %s", (address, inPool) => {
    expect(isClaudeAiPool(address)).toBe(inPool);
    const caller = identify()({ [SOURCE_IP_HEADER]: address }, NOON);
    if (inPool) {
      expect(caller).toMatchObject({ kind: "pool", key: CLAUDE_AI_POOL_KEY });
    } else {
      expect(caller?.kind).toBe("network");
    }
  });
});

describe("identify: network keys", () => {
  it("is HMAC-SHA256(secret, utcDay|network), hex, truncated", () => {
    const caller = identify()({ [SOURCE_IP_HEADER]: "198.51.100.7" }, NOON);
    const expected = createHmac("sha256", SECRET)
      .update("2026-10-05|198.51.100.7")
      .digest("hex")
      .slice(0, CALLER_KEY_HEX_LENGTH);
    expect(caller).toEqual({ kind: "network", key: expected, labels: {}, bypass: false });
    expect(caller?.key).toMatch(new RegExp(`^[0-9a-f]{${CALLER_KEY_HEX_LENGTH}}$`));
  });

  it("is stable within a UTC day and changes when the UTC day changes", () => {
    const id = identify();
    const headers = { [SOURCE_IP_HEADER]: "198.51.100.7" };
    const start = id(headers, new Date("2026-10-05T00:00:00.000Z"))?.key;
    const end = id(headers, new Date("2026-10-05T23:59:59.999Z"))?.key;
    const next = id(headers, new Date("2026-10-06T00:00:00.000Z"))?.key;
    expect(start).toBe(end);
    expect(next).not.toBe(start);
  });

  it("differs between addresses and between secrets", () => {
    const headers = { [SOURCE_IP_HEADER]: "198.51.100.7" };
    const other = { [SOURCE_IP_HEADER]: "198.51.100.8" };
    expect(identify()(headers, NOON)?.key).not.toBe(identify()(other, NOON)?.key);
    expect(identify()(headers, NOON)?.key).not.toBe(
      identify({ secret: "another-secret" })(headers, NOON)?.key,
    );
  });

  it("keys an IPv4-mapped IPv6 address as its IPv4 address", () => {
    const mapped = identify()({ [SOURCE_IP_HEADER]: "::ffff:198.51.100.7" }, NOON);
    const plain = identify()({ [SOURCE_IP_HEADER]: "198.51.100.7" }, NOON);
    expect(mapped?.key).toBe(plain?.key);
  });

  it("keys IPv6 addresses by their /64", () => {
    const id = identify();
    const a = id({ [SOURCE_IP_HEADER]: "2001:db8:1:2::1" }, NOON);
    const b = id({ [SOURCE_IP_HEADER]: "2001:0db8:0001:0002:ffff:eeee:dddd:cccc" }, NOON);
    const c = id({ [SOURCE_IP_HEADER]: "2001:db8:1:3::1" }, NOON);
    expect(a?.key).toBe(b?.key);
    expect(a?.key).not.toBe(c?.key);
  });

  it("networkOf normalises IPv4, mapped and IPv6 forms", () => {
    expect(networkOf("198.51.100.7")).toBe("198.51.100.7");
    expect(networkOf(" ::FFFF:198.51.100.7 ")).toBe("198.51.100.7");
    expect(networkOf("::ffff:c633:6407")).toBe("198.51.100.7");
    expect(networkOf("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(networkOf("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(networkOf("::1")).toBe("0:0:0:0::/64");
  });

  it("never carries the raw address anywhere on the Caller", () => {
    const addresses = ["198.51.100.7", "2001:db8:1:2::1", "::ffff:198.51.100.7"];
    for (const address of addresses) {
      const caller = identify()(
        {
          [SOURCE_IP_HEADER]: address,
          "user-agent": "claude-code/2.0",
          [OPERATOR_BYPASS_HEADER]: TOKEN,
        },
        NOON,
      );
      const serialized = JSON.stringify(caller);
      expect(serialized).not.toContain(address);
      expect(serialized).not.toContain("198.51.100");
      expect(serialized).not.toContain("2001:db8");
    }
  });
});

describe("identify: labels", () => {
  it("carries the User-Agent, truncated, as a metric label", () => {
    const long = "x".repeat(LABEL_MAX_LENGTH + 50);
    const caller = identify()({ [SOURCE_IP_HEADER]: "198.51.100.7", "user-agent": long }, NOON);
    expect(caller?.labels.userAgent).toBe("x".repeat(LABEL_MAX_LENGTH));
    const short = identify()(
      { [SOURCE_IP_HEADER]: "198.51.100.7", "user-agent": "claude-code/2.0" },
      NOON,
    );
    expect(short?.labels).toEqual({ userAgent: "claude-code/2.0" });
  });
});

describe("identify: operator bypass", () => {
  const headers = (token?: string) => ({
    [SOURCE_IP_HEADER]: "198.51.100.7",
    ...(token === undefined ? {} : { [OPERATOR_BYPASS_HEADER]: token }),
  });

  it("is true only for the exact token", () => {
    expect(identify()(headers(TOKEN), NOON)?.bypass).toBe(true);
    expect(identify()(headers(`${TOKEN}x`), NOON)?.bypass).toBe(false);
    expect(identify()(headers(TOKEN.slice(0, -1)), NOON)?.bypass).toBe(false);
    expect(identify()(headers("wrong"), NOON)?.bypass).toBe(false);
    expect(identify()(headers(), NOON)?.bypass).toBe(false);
    expect(identify()(headers(""), NOON)?.bypass).toBe(false);
  });

  it("is false whenever the expected token is unset or empty, even for an empty header", () => {
    for (const operatorToken of [undefined, ""]) {
      const id = identify({ operatorToken });
      expect(id(headers(""), NOON)?.bypass).toBe(false);
      expect(id(headers(TOKEN), NOON)?.bypass).toBe(false);
      expect(id(headers(), NOON)?.bypass).toBe(false);
    }
  });

  it("applies to the pool too", () => {
    const caller = identify()(
      { [SOURCE_IP_HEADER]: "160.79.104.10", [OPERATOR_BYPASS_HEADER]: TOKEN },
      NOON,
    );
    expect(caller).toMatchObject({ kind: "pool", bypass: true });
  });
});

describe("identify: no secret", () => {
  it("returns undefined for every address and warns exactly once", () => {
    const warn = vi.fn();
    const id = createIdentify({ secret: undefined, operatorToken: TOKEN, warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(CALLER_SECRET_ENV);
    expect(id({ [SOURCE_IP_HEADER]: "198.51.100.7" }, NOON)).toBeUndefined();
    expect(id({ [SOURCE_IP_HEADER]: "160.79.104.1" }, NOON)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats an empty secret as unset", () => {
    const warn = vi.fn();
    const id = createIdentify({ secret: "", warn });
    expect(id({ [SOURCE_IP_HEADER]: "198.51.100.7" }, NOON)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when a secret is set", () => {
    const warn = vi.fn();
    createIdentify({ secret: SECRET, warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("identifyFromEnv", () => {
  it("reads the secret and the operator token from the environment", () => {
    const id = identifyFromEnv(
      { [CALLER_SECRET_ENV]: SECRET, [OPERATOR_TOKEN_ENV]: TOKEN },
      () => {},
    );
    const fromEnv = id(
      { [SOURCE_IP_HEADER]: "198.51.100.7", [OPERATOR_BYPASS_HEADER]: TOKEN },
      NOON,
    );
    const direct = identify()(
      { [SOURCE_IP_HEADER]: "198.51.100.7", [OPERATOR_BYPASS_HEADER]: TOKEN },
      NOON,
    );
    expect(fromEnv).toEqual(direct);
    expect(fromEnv?.bypass).toBe(true);
  });
});

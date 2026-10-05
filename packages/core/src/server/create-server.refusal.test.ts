import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EnvelopeSchema } from "../envelope/index.js";
import type { LimitsConfig } from "../limits/config.js";
import { LimitExceededError, type Limiter } from "../limits/limiter.js";
import { type CreateServerOptions, createServer } from "./create-server.js";
import type { ServerDefinition, ToolDefinition } from "./definition.js";

/**
 * The shell's side of the refusal shape (ADR-020 §4, #323): a refused call reaches the host as an
 * `isError` result with the sentence and an envelope carrying the `limit` block, and
 * `describe_source` reports the configured limits and today's remaining service budget.
 */
const RESET = "2026-10-06T00:00:00.000Z";
const NOW = new Date("2026-10-05T12:00:00.000Z");
const input = z.object({});

const refused: ToolDefinition<typeof input, never> = {
  name: "demo_get_indicator",
  title: "Refused",
  description: "Always refused by this network's share of upstream queries.",
  input,
  examples: [{ title: "r", input: {} }],
  handler: async () => {
    throw new LimitExceededError({
      scope: "network",
      kind: "upstream",
      source: "bls",
      limit: 100,
      used: 100,
      resetsAt: RESET,
    });
  },
};

const definition: ServerDefinition = {
  name: "federal-mcps-demo",
  version: "0.0.0",
  agency: "demo",
  instructions: "Demo.",
  tools: [refused],
  describeSource: () => ({
    agency: "demo",
    agencyName: "Demo Agency",
    homepage: "https://example.invalid",
    programs: [],
    quota: "none",
    caveats: [],
    citationFormat: "Demo",
  }),
};

async function connect(options: CreateServerOptions = {}): Promise<Client> {
  const server = createServer(definition, { now: () => NOW, ...options });
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createServer: refusals", () => {
  it("returns isError with the sentence and an envelope carrying the limit block", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "demo_get_indicator", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as { text: string }[])[0]?.text;
    expect(text).toBe(
      `demo: this network has used its 100 BLS queries for today; resets at ${RESET}. ` +
        "Tools that need no new query (demo_describe_source) still work.",
    );
    const env = EnvelopeSchema.parse(result.structuredContent);
    expect(env.data).toBeNull();
    expect(env.source).toMatchObject({
      agency: "demo",
      program: "demo_get_indicator",
      url: "https://example.invalid",
    });
    expect(env.retrievedAt).toBe(NOW.toISOString());
    expect(env.limitations).toEqual([text]);
    expect(env.limit).toMatchObject({ scope: "network", limit: 100, used: 100, resetsAt: RESET });
    await client.close();
  });
});

describe("createServer: describe_source limits", () => {
  const limits: LimitsConfig = {
    serviceDaily: { bls: 490 },
    network: { upstreamDaily: 100, toolCallsDaily: 1000 },
    pool: { upstreamDaily: 250, toolCallsDaily: 5000 },
  };
  const limiter: Limiter = {
    beginToolCall: async () => undefined,
    beforeUpstream: async () => undefined,
    usage: async (source) =>
      source === "bls" ? { source, used: 40, limit: 490, resetsAt: RESET } : undefined,
  };

  async function describeData(options: CreateServerOptions = {}): Promise<Record<string, unknown>> {
    const client = await connect(options);
    const result = await client.callTool({ name: "demo_describe_source", arguments: {} });
    await client.close();
    return EnvelopeSchema.parse(result.structuredContent).data as Record<string, unknown>;
  }

  it("has no limits block without a configuration", async () => {
    expect(await describeData()).not.toHaveProperty("limits");
  });

  it("reports the configured shares and today's remaining service budget", async () => {
    const data = await describeData({ limits, limiter });
    expect(data.limits).toEqual({
      network: { upstreamDaily: 100, toolCallsDaily: 1000 },
      pool: { upstreamDaily: 250, toolCallsDaily: 5000 },
      service: { bls: { daily: 490, used: 40, remaining: 450, resetsAt: RESET } },
    });
  });

  it("reports the configured budget alone when no limiter counts it", async () => {
    const data = await describeData({ limits });
    expect(data.limits).toMatchObject({ service: { bls: { daily: 490 } } });
    expect((data.limits as { service: { bls: object } }).service.bls).not.toHaveProperty(
      "remaining",
    );
  });

  it("reads the configuration from FEDERAL_MCPS_LIMITS when none is passed", async () => {
    vi.stubEnv("FEDERAL_MCPS_LIMITS", JSON.stringify({ network: { upstreamDaily: 7 } }));
    const data = await describeData();
    expect(data.limits).toEqual({ network: { upstreamDaily: 7 } });
  });
});

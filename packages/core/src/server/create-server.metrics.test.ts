import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDefinition } from "./__fixtures__/demo-definition.js";
import { createServer } from "./create-server.js";

/**
 * The shell's per-call metrics hook (#326, ADR-020 §5): the EMF log line is gated on
 * `AWS_LAMBDA_FUNCTION_NAME` so stdio's JSON-RPC stdout stream is never touched, and the
 * line itself never carries an argument, a result value, or anything that looks like one.
 */

const originalFn = process.env.AWS_LAMBDA_FUNCTION_NAME;

async function connected() {
  const server = createServer(demoDefinition);
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("createServer: the per-call metrics line", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    if (originalFn === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = originalFn;
  });

  it("writes nothing when not running on Lambda (stdio/local): the protocol stream is untouched", async () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    const { client, close } = await connected();
    try {
      await client.callTool({
        name: "demo_get_raw",
        arguments: { text: "a secret argument nobody should log" },
      });
    } finally {
      await close();
    }
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs one ok-outcome EMF line per successful call when on Lambda, with no argument text", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "rc-demo-mcp-dev";
    const { client, close } = await connected();
    const secretArgument = "super-secret-place-name-xyz";
    try {
      await client.callTool({ name: "demo_get_raw", arguments: { text: secretArgument } });
    } finally {
      await close();
    }
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0] as string;
    expect(line).not.toContain(secretArgument);
    const parsed = JSON.parse(line);
    expect(parsed.server).toBe("demo");
    expect(parsed.tool).toBe("demo_get_raw");
    expect(parsed.outcome).toBe("ok");
    expect(parsed.callerKind).toBe("none"); // in-memory transport carries no HTTP caller
    expect(typeof parsed.LatencyMs).toBe("number");
    expect(parsed.UpstreamCalls).toBe(0);
  });

  it("logs an error-outcome EMF line when the handler throws a non-refusal error", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "rc-demo-mcp-dev";
    const { client, close } = await connected();
    try {
      await client.callTool({ name: "demo_get_indicator", arguments: {} });
    } finally {
      await close();
    }
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed.tool).toBe("demo_get_indicator");
    expect(parsed.outcome).toBe("refused");
    expect(parsed.limitScope).toBe("service");
  });
});

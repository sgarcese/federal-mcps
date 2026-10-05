import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LimitExceededError } from "../limits/limiter.js";
import { createServer } from "../server/create-server.js";
import type { ServerDefinition, ToolDefinition } from "../server/definition.js";
import { compliantDefinition } from "./__fixtures__/compliant.js";
import { checkFamilyContract } from "./contract.js";
import { checkRefusalResult } from "./rules/refusal.js";

/**
 * The `refusal-shape` contract rule (ADR-020 §4, #323): a refused call reaches the host as an
 * `isError` result with a non-empty sentence and an envelope carrying a valid `limit` block.
 */
const RESET = "2026-10-06T00:00:00.000Z";
const input = z.object({});

const refused: ToolDefinition<typeof input, never> = {
  name: "demo_get_indicator",
  title: "Refused",
  description: "Always refused.",
  input,
  examples: [{ title: "r", input: {} }],
  handler: async () => {
    throw new LimitExceededError({
      scope: "pool",
      kind: "toolCalls",
      limit: 10,
      used: 10,
      resetsAt: RESET,
    });
  },
};

const demo: ServerDefinition = {
  ...compliantDefinition,
  tools: [refused],
};

async function callRefused(): Promise<unknown> {
  const server = createServer(demo);
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  const result = await client.callTool({ name: "demo_get_indicator", arguments: {} });
  await client.close();
  return result;
}

describe("checkRefusalResult", () => {
  it("accepts what the shell renders for a tool that throws LimitExceededError", async () => {
    expect(checkRefusalResult(await callRefused())).toEqual([]);
  });

  it("rejects a result that is not marked isError", async () => {
    const result = (await callRefused()) as Record<string, unknown>;
    expect(checkRefusalResult({ ...result, isError: false })).not.toEqual([]);
  });

  it("rejects an empty sentence", async () => {
    const result = (await callRefused()) as Record<string, unknown>;
    expect(checkRefusalResult({ ...result, content: [{ type: "text", text: " " }] })).not.toEqual(
      [],
    );
  });

  it("rejects a missing or invalid limit block", async () => {
    const result = (await callRefused()) as { structuredContent: Record<string, unknown> };
    const { limit: _limit, ...noLimit } = result.structuredContent;
    expect(checkRefusalResult({ ...result, structuredContent: noLimit })).not.toEqual([]);
    expect(
      checkRefusalResult({
        ...result,
        structuredContent: { ...result.structuredContent, limit: { scope: "everyone" } },
      }),
    ).not.toEqual([]);
  });
});

describe("the refusal-shape rule", () => {
  it("runs on every definition and passes the compliant one", async () => {
    const report = await checkFamilyContract(compliantDefinition);
    expect(report.checked).toContain("refusal-shape");
    expect(report.violations.filter((v) => v.rule === "refusal-shape")).toEqual([]);
  });
});

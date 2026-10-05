import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildCitation } from "../envelope/index.js";
import { currentCall } from "../limits/context.js";
import { createServer } from "./create-server.js";
import type { ServerDefinition, ToolDefinition } from "./definition.js";

/**
 * The shell runs every tool call inside a per-call context (ADR-020 seam, wave 2): code far from
 * the handler can read the caller and leave notes, which the shell appends to the answer's
 * limitations after the handler's own.
 */
const input = z.object({});
const noting: ToolDefinition<typeof input, { inCall: boolean }> = {
  name: "demo_get_raw",
  title: "Noting",
  description: "Leaves a note in the call context.",
  input,
  examples: [{ title: "n", input: {} }],
  handler: async (_input, context) => {
    const call = currentCall();
    call?.notes.push("BLS daily quota 85% used; later answers may come from cache.");
    const parts = { agency: "demo", program: "N", ids: [], url: "https://example.invalid" };
    return {
      data: { inCall: call !== undefined },
      source: { ...parts, citation: buildCitation(parts, context.now()) },
      limitations: ["the handler's own limitation"],
    };
  },
};

const definition: ServerDefinition = {
  name: "federal-mcps-demo",
  version: "0.0.0",
  agency: "demo",
  instructions: "Demo.",
  tools: [noting],
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

describe("createServer: the per-call context", () => {
  it("runs the handler inside a call and appends its notes after the handler's limitations", async () => {
    const server = createServer(definition);
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    const result = await client.callTool({ name: "demo_get_raw", arguments: {} });
    const env = result.structuredContent as { data: { inCall: boolean }; limitations: string[] };
    expect(env.data.inCall).toBe(true);
    expect(env.limitations).toEqual([
      "the handler's own limitation",
      "BLS daily quota 85% used; later answers may come from cache.",
    ]);
    await client.close();
    await server.close();
  });
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { EnvelopeSchema } from "../envelope/index.js";
import { createServer } from "./create-server.js";
import { describeSourceToolName } from "./definition.js";
import { DEMO_INSTRUCTIONS, demoDefinition } from "./__fixtures__/demo-definition.js";

const NOW = new Date("2026-09-08T12:00:00.000Z");

let open: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of open) {
    await close();
  }
  open = [];
});

async function connected(): Promise<Client> {
  const server = createServer(demoDefinition, { now: () => NOW });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  open.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe("createServer", () => {
  it("reports the definition's name and version, and passes instructions to the host", async () => {
    const client = await connected();
    expect(client.getServerVersion()).toMatchObject({
      name: demoDefinition.name,
      version: demoDefinition.version,
    });
    expect(client.getInstructions()).toBe(DEMO_INSTRUCTIONS);
  });

  it("registers every definition tool plus <agency>_describe_source", async () => {
    const client = await connected();
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["demo_describe_source", "demo_get_indicator", "demo_get_raw"]);
    expect(names).toContain(describeSourceToolName(demoDefinition.agency));
  });

  it("sets the family annotations on every tool", async () => {
    const client = await connected();
    for (const tool of (await client.listTools()).tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
  });

  it("advertises the input schema and the envelope output schema", async () => {
    const client = await connected();
    const tools = (await client.listTools()).tools;
    const echo = tools.find((tool) => tool.name === "demo_get_raw");
    expect(echo?.inputSchema.properties).toHaveProperty("text");
    expect(echo?.outputSchema?.properties).toHaveProperty("source");
    const describe = tools.find((tool) => tool.name === "demo_describe_source");
    expect(describe?.inputSchema.properties ?? {}).toEqual({});
  });

  it("wraps a handler result in the envelope and a text rendering", async () => {
    const client = await connected();
    const result = await client.callTool({ name: "demo_get_raw", arguments: { text: "hi" } });
    const env = EnvelopeSchema.parse(result.structuredContent);
    expect(env.data).toEqual({ text: "hi" });
    expect(env.retrievedAt).toBe(NOW.toISOString());
    expect(env.place?.geoid).toBe("08031");
    expect(env.footnotes).toHaveLength(1);
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("Denver County");
  });

  it("answers describe_source from the definition, in an envelope", async () => {
    const client = await connected();
    const result = await client.callTool({ name: "demo_describe_source", arguments: {} });
    const env = EnvelopeSchema.parse(result.structuredContent);
    expect(env.data).toEqual(demoDefinition.describeSource());
    expect(env.source).toMatchObject({
      agency: "demo",
      program: "describe_source",
      ids: [],
      url: "https://example.invalid",
    });
    expect(env.source.citation).toContain("Retrieved 2026-09-08");
  });

  it("turns a thrown handler error into a tool error naming the agency and the quota reset", async () => {
    const client = await connected();
    const result = await client.callTool({ name: "demo_get_indicator", arguments: {} });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("demo:");
    expect(text).toContain("quota");
    expect(text).toContain("2026-09-09T00:00:00.000Z");
    expect(text).not.toContain("create-server.ts");
    expect(text).not.toContain("    at ");
  });

  it("leaves input validation to the SDK", async () => {
    const client = await connected();
    const result = await client.callTool({ name: "demo_get_raw", arguments: { text: 42 } });
    // The SDK validates `inputSchema` before the handler runs; the shell must
    // not produce a second, differently worded message for the same mistake.
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Input validation error");
  });
});

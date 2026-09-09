import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { EnvelopeSchema } from "../envelope/index.js";
import { demoDefinition } from "./__fixtures__/demo-definition.js";

/**
 * The stdio transport is tested the way a host actually uses it: spawn the
 * server as a child process and talk JSON-RPC over its stdin/stdout. Anything
 * the shell writes to stdout that is not a protocol message breaks this test,
 * which is exactly the regression worth catching.
 */
const tsx = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));
const fixture = fileURLToPath(new URL("./__fixtures__/demo-stdio.ts", import.meta.url));

describe.runIf(existsSync(tsx))("runStdio", () => {
  it("serves initialize, tools/list and tools/call over a spawned process", async () => {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const transport = new StdioClientTransport({ command: tsx, args: [fixture] });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()).toMatchObject({ name: demoDefinition.name });
      expect(client.getInstructions()).toBe(demoDefinition.instructions);

      const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["demo_describe_source", "demo_get_indicator", "demo_get_raw"]);

      const result = await client.callTool({
        name: "demo_get_raw",
        arguments: { text: "over stdio" },
      });
      const env = EnvelopeSchema.parse(result.structuredContent);
      expect(env.data).toEqual({ text: "over stdio" });
    } finally {
      await client.close();
    }
  }, 30_000);
});

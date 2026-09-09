import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { definition } from "./definition.js";

/**
 * Spawns the `federal-mcps-bls` bin's source directly under `tsx`, the same
 * way the shell's own `stdio.test.ts` (`packages/core/src/server/stdio.test.ts`)
 * spawns its fixture — a real child process talking JSON-RPC over
 * stdin/stdout, which is exactly how Claude Desktop and Claude Code launch
 * this server. This does not require `npm run build` first; the built
 * `dist/stdio.js` is exercised separately by the manual `npx federal-mcps-bls`
 * check recorded in the PR.
 */
const tsx = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));
const bin = fileURLToPath(new URL("./stdio.ts", import.meta.url));

describe.runIf(existsSync(tsx))("federal-mcps-bls over stdio", () => {
  it("serves initialize and tools/list, including bls_describe_source", async () => {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const transport = new StdioClientTransport({ command: tsx, args: [bin] });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()).toMatchObject({ name: definition.name });
      expect(client.getInstructions()).toBe(definition.instructions);

      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual(["bls_describe_source"]);
    } finally {
      await client.close();
    }
  }, 30_000);
});

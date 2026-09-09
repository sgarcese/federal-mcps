import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GeographyCatalog } from "@federal-mcps/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildBlsDefinition } from "./definition.js";

/**
 * Spawns the `federal-mcps-bls` bin's source directly under `tsx`, the same
 * way the shell's own `stdio.test.ts` (`packages/core/src/server/stdio.test.ts`)
 * spawns its fixture — a real child process talking JSON-RPC over stdin/stdout,
 * which is exactly how Claude Desktop and Claude Code launch this server. The
 * child opens the bundled catalog, so it is given GEO_CATALOG_PATH pointing at a
 * fixture (in the deployed Lambda, Terraform sets it). This does not require
 * `npm run build` first.
 */
const tsx = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));
const bin = fileURLToPath(new URL("./stdio.ts", import.meta.url));

let catalogPath: string;
// Expected name/instructions come from the definition built over a fixture catalog;
// they do not depend on catalog contents.
let expected: ReturnType<typeof buildBlsDefinition>;

beforeAll(() => {
  catalogPath = buildFixtureCatalog();
  expected = buildBlsDefinition(new GeographyCatalog(catalogPath));
});
afterAll(() => {
  rmSync(dirname(catalogPath), { recursive: true, force: true });
});

describe.runIf(existsSync(tsx))("federal-mcps-bls over stdio", () => {
  it("serves initialize and tools/list, including bls_resolve_place", async () => {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const env: Record<string, string> = { GEO_CATALOG_PATH: catalogPath };
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.GEO_CATALOG_PATH = catalogPath;
    const transport = new StdioClientTransport({ command: tsx, args: [bin], env });
    await client.connect(transport);
    try {
      expect(client.getServerVersion()).toMatchObject({ name: expected.name });
      expect(client.getInstructions()).toBe(expected.instructions);

      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain("bls_resolve_place");
      expect(names).toContain("bls_describe_source");
    } finally {
      await client.close();
    }
  }, 30_000);
});

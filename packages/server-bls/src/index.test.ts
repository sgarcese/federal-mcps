import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { createBlsServer, definition, describeSource } from "./index.js";

describe("@federal-mcps/server-bls entry point", () => {
  it("re-exports the definition and describeSource", () => {
    expect(definition.agency).toBe("bls");
    expect(describeSource().agency).toBe("bls");
  });

  it("createBlsServer builds the shell's server from the BLS definition", () => {
    const server: McpServer = createBlsServer();
    expect(server).toBeDefined();
  });

  it("createBlsServer accepts createServer's options (e.g. an injectable clock)", () => {
    const now = () => new Date("2026-09-08T00:00:00.000Z");
    const server = createBlsServer({ now });
    expect(server).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildCitation } from "../envelope/index.js";
import {
  describeSourceToolName,
  type ServerDefinition,
  type ToolDefinition,
} from "./definition.js";

/**
 * A minimal definition that must typecheck against the seam. Wave 3 agents
 * (#6, #7) can use it as the canonical "compliant" fixture shape.
 */
const echoInput = z.object({ text: z.string() });

const echo: ToolDefinition<typeof echoInput, { text: string }> = {
  name: "demo_get_raw",
  title: "Get raw series",
  description: "Echoes text back, wrapped in the family envelope.",
  input: echoInput,
  examples: [{ title: "hello", input: { text: "hello" } }],
  handler: async (input, context) => ({
    data: { text: input.text },
    source: {
      agency: "demo",
      program: "Echo",
      ids: ["ECHO"],
      url: "https://example.invalid/echo",
      citation: buildCitation(
        { agency: "demo", program: "Echo", ids: ["ECHO"], url: "https://example.invalid/echo" },
        context.now(),
      ),
    },
  }),
};

const definition: ServerDefinition = {
  name: "federal-mcps-demo",
  version: "0.0.0",
  agency: "demo",
  instructions: "Demo server used by seam tests.",
  tools: [echo],
  describeSource: () => ({
    agency: "demo",
    agencyName: "Demo Agency",
    homepage: "https://example.invalid",
    programs: [
      { code: "ECHO", name: "Echo", granularity: "n/a", cadence: "n/a", status: "available" },
    ],
    caveats: [],
    citationFormat: "Demo Agency, Echo. Retrieved <date> from <url>",
  }),
};

describe("server definition seam", () => {
  it("a compliant definition typechecks and its handler returns a wrappable result", async () => {
    const result = await echo.handler(
      { text: "hi" },
      { now: () => new Date("2026-09-08T00:00:00Z") },
    );
    expect(result.data).toEqual({ text: "hi" });
    expect(result.source.citation).toContain("Retrieved 2026-09-08");
    expect(definition.tools).toHaveLength(1);
  });

  it("names the auto-registered describe_source tool by agency", () => {
    expect(describeSourceToolName("bls")).toBe("bls_describe_source");
  });
});

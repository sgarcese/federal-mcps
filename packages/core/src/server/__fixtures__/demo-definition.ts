import { z } from "zod";
import { buildCitation, placeRef, type Source } from "../../envelope/index.js";
import { QuotaExceededError } from "../../http/index.js";
import type { ServerDefinition, ToolDefinition } from "../definition.js";

/**
 * The demo server definition used by the shell's own tests and by the stdio
 * fixture process (`demo-stdio.ts`).
 *
 * It is deliberately the smallest thing that exercises every branch of the
 * shell: a tool that succeeds with a place and a footnote, and a tool that
 * throws a typed HTTP-client error. It calls no agency API, so it is safe to
 * run anywhere (CLAUDE.md: "Agency APIs are never called in unit tests").
 */

const DEMO_URL = "https://example.invalid/echo";

function demoSource(retrievedAt: Date): Source {
  const parts = { agency: "demo", program: "Echo", ids: ["ECHO-1"], url: DEMO_URL };
  return { ...parts, citation: buildCitation(parts, retrievedAt) };
}

const echoInput = z.object({ text: z.string().describe("Text to echo back.") });

const echo: ToolDefinition<typeof echoInput, { text: string }> = {
  name: "demo_get_raw",
  description: "Echoes text back, wrapped in the family envelope.",
  input: echoInput,
  examples: [{ title: "hello", input: { text: "hello" } }],
  handler: async (input, context) => ({
    data: { text: input.text },
    source: demoSource(context.now()),
    place: placeRef({ geoid: "08031", sumlevel: "050", label: "county", name: "Denver County" }),
    footnotes: [{ code: "P", text: "Preliminary.", flags: ["preliminary"] }],
    limitations: ["Demo data; not a real statistic."],
  }),
};

const failingInput = z.object({});

/** Always throws, so the shell's error mapping can be tested end to end. */
const failing: ToolDefinition<typeof failingInput, never> = {
  name: "demo_get_indicator",
  description: "Always fails with a quota error; exercises the shell's error mapping.",
  input: failingInput,
  examples: [{ title: "fails", input: {} }],
  handler: async () => {
    throw new QuotaExceededError({ source: "demo", resetsAt: "2026-09-09T00:00:00.000Z" });
  },
};

export const DEMO_INSTRUCTIONS =
  "Demo server. Resolve a place first, then ask for an indicator; every answer carries its source.";

export const demoDefinition: ServerDefinition = {
  name: "federal-mcps-demo",
  version: "0.0.0",
  agency: "demo",
  instructions: DEMO_INSTRUCTIONS,
  tools: [echo, failing],
  describeSource: () => ({
    agency: "demo",
    agencyName: "Demo Agency",
    homepage: "https://example.invalid",
    programs: [
      { code: "ECHO", name: "Echo", granularity: "county", cadence: "n/a", status: "available" },
    ],
    quota: "no quota; nothing is fetched",
    caveats: ["Nothing here is a real statistic."],
    citationFormat: "Demo Agency, Echo. Retrieved <date> from <url>",
  }),
};

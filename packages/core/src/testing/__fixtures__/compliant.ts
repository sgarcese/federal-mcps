import { z } from "zod";
import { buildCitation } from "../../envelope/index.js";
import type {
  ServerDefinition,
  ToolDefinition,
  ToolHandlerResult,
} from "../../server/definition.js";

/**
 * The canonical compliant fixture: the demo shape from `server/definition.test.ts`
 * grown to cover every family verb the contract harness checks. Every rule has a
 * positive test against this definition; the broken fixtures beside it are this
 * one with a single deliberate defect.
 */

const DEMO_URL = "https://example.invalid/echo";

function demoResult(
  ids: readonly string[],
  now: Date,
): ToolHandlerResult<{ ids: readonly string[] }> {
  const source = {
    agency: "demo",
    program: "Echo",
    ids: [...ids],
    url: DEMO_URL,
  };
  return {
    data: { ids },
    source: { ...source, citation: buildCitation(source, now) },
  };
}

const listInput = z.object({ query: z.string().optional(), topic: z.string().optional() });
const listIndicators: ToolDefinition<typeof listInput, { ids: readonly string[] }> = {
  name: "demo_list_indicators",
  title: "List indicators",
  description: "Lists the indicators the demo source reports.",
  input: listInput,
  examples: [{ title: "everything", input: {} }],
  handler: async (_input, context) => demoResult(["ECHO"], context.now()),
};

const indicatorInput = z.object({
  indicator: z.string(),
  place: z.string(),
  start: z.string().optional(),
});
const getIndicator: ToolDefinition<typeof indicatorInput, { ids: readonly string[] }> = {
  name: "demo_get_indicator",
  title: "Get indicator",
  description: "Returns one indicator for one place over time.",
  input: indicatorInput,
  examples: [{ title: "echo in Denver", input: { indicator: "ECHO", place: "0820000" } }],
  handler: async (input, context) => demoResult([input.indicator], context.now()),
};

const compareInput = z.object({ indicator: z.string(), places: z.array(z.string()) });
const comparePlaces: ToolDefinition<typeof compareInput, { ids: readonly string[] }> = {
  name: "demo_compare_places",
  title: "Compare places",
  description: "Compares one indicator across places, aligned on period.",
  input: compareInput,
  examples: [{ title: "two places", input: { indicator: "ECHO", places: ["0820000", "0876000"] } }],
  handler: async (input, context) => demoResult([input.indicator], context.now()),
};

const rawInput = z.object({ ids: z.array(z.string()) });
const getRaw: ToolDefinition<typeof rawInput, { ids: readonly string[] }> = {
  name: "demo_get_raw",
  title: "Get raw series",
  description: "Echoes raw ids back, wrapped in the family envelope.",
  input: rawInput,
  examples: [{ title: "hello", input: { ids: ["ECHO"] } }],
  handler: async (input, context) => demoResult(input.ids, context.now()),
};

/** A tool whose name ends in no family verb: the verb rule must leave it alone. */
const unemployment: ToolDefinition<typeof indicatorInput, { ids: readonly string[] }> = {
  name: "demo_get_unemployment",
  title: "Get unemployment",
  description: "An agency-specific tool that ends in no family verb.",
  input: indicatorInput,
  examples: [{ title: "Denver", input: { indicator: "LAUS", place: "0820000" } }],
  handler: async (input, context) => demoResult([input.indicator], context.now()),
};

export const compliantDefinition: ServerDefinition = {
  name: "federal-mcps-demo",
  version: "0.0.0",
  agency: "demo",
  instructions: "Demo server used by the contract harness tests.",
  tools: [listIndicators, getIndicator, comparePlaces, getRaw, unemployment],
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

/** Clones the compliant definition with `tools` replaced or extended. */
export function withTools(tools: ServerDefinition["tools"]): ServerDefinition {
  return { ...compliantDefinition, tools };
}

export { comparePlaces, getIndicator, getRaw, listIndicators, unemployment };

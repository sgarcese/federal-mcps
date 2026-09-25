import { z } from "zod";
import type { ServerDefinition, ToolDefinition } from "../../server/definition.js";
import { compliantDefinition, getRaw, withTools } from "./compliant.js";

/**
 * Deliberately broken definitions, one defect each. Every rule has a negative
 * test against exactly one of these, so a rule that stops firing fails a test
 * rather than quietly passing every server.
 */

const anyInput = z.object({ ids: z.array(z.string()) });

function variant(overrides: Partial<ToolDefinition>): ToolDefinition {
  return { ...getRaw, ...overrides } as ToolDefinition;
}

/** `tool-name-format`: capitals and a hyphen are outside `^[a-z][a-z0-9_]{0,63}$`. */
export const badToolName: ServerDefinition = withTools([variant({ name: "demo_Get-Raw" })]);

/** `tool-name-format`: 65 characters, one past the MCP limit. */
export const overlongToolName: ServerDefinition = withTools([
  variant({ name: `demo_${"a".repeat(60)}` }),
]);

/** `tool-name-prefix`: a tool that forgot the agency prefix. */
export const missingPrefix: ServerDefinition = withTools([variant({ name: "get_raw" })]);

/** `tool-title`: blank. */
export const missingTitle: ServerDefinition = withTools([variant({ title: " " })]);

/** `tool-description`: empty. */
export const emptyDescription: ServerDefinition = withTools([variant({ description: "   " })]);

/** `tool-description`: 1,001 characters, one past the limit. */
export const overlongDescription: ServerDefinition = withTools([
  variant({ description: "x".repeat(1001) }),
]);

/** `verb-parameters`: `get_raw` without the required `ids` key. */
export const verbMissingParameters: ServerDefinition = withTools([
  variant({ input: z.object({ series: z.array(z.string()) }) }),
]);

/** `verb-parameters`: an input schema that is not an object at all. */
export const verbNonObjectInput: ServerDefinition = withTools([
  variant({ input: z.array(z.string()) }),
]);

/** `describe-source-present`: the reported agency disagrees with the definition. */
export const describeSourceAgencyMismatch: ServerDefinition = {
  ...compliantDefinition,
  describeSource: () => ({ ...compliantDefinition.describeSource(), agency: "other" }),
};

/** `describe-source-present`: no programs. */
export const describeSourceNoPrograms: ServerDefinition = {
  ...compliantDefinition,
  describeSource: () => ({ ...compliantDefinition.describeSource(), programs: [] }),
};

/** `describe-source-duplicate`: the shell registers this tool; a definition must not. */
export const duplicateDescribeSource: ServerDefinition = withTools([
  ...compliantDefinition.tools,
  variant({ name: "demo_describe_source", input: z.object({}) }),
]);

/** `no-own-resolve-place`: geography belongs to core (ADR-003 §8). */
export const ownResolvePlace: ServerDefinition = withTools([
  ...compliantDefinition.tools,
  variant({ name: "demo_resolve_place", input: z.object({ query: z.string() }) }),
]);

/** `examples-run`: the example input does not parse with the tool's own schema. */
export const exampleFailsSchema: ServerDefinition = withTools([
  variant({ examples: [{ title: "wrong shape", input: { ids: "ECHO" } }] }),
]);

/** `examples-run`: the handler rejects. */
export const handlerThrows: ServerDefinition = withTools([
  variant({
    input: anyInput,
    handler: async () => {
      throw new Error("upstream exploded");
    },
  }),
]);

/** `examples-run`: the handler resolves something the envelope schema rejects. */
export const handlerReturnsUnwrappable: ServerDefinition = withTools([
  variant({
    input: anyInput,
    // biome-ignore lint/suspicious/noExplicitAny: deliberately violating the handler contract.
    handler: async () => ({ data: { ids: [] } }) as any,
  }),
]);

/** `examples-run`: no examples at all (only reachable from JavaScript or a cast). */
export const noExamples: ServerDefinition = withTools([
  // biome-ignore lint/suspicious/noExplicitAny: the seam's type forbids this; the harness still checks it.
  variant({ examples: [] as any }),
]);

/** `slow-example`: a handler slower than the configured budget. */
export const slowHandler: ServerDefinition = withTools([
  variant({
    input: anyInput,
    handler: async (input, context) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return getRaw.handler(anyInput.parse(input), context);
    },
  }),
]);

/** `raw-rendering`: a `get_raw` tool with no compact renderer or text budget (#210). */
export const rawWithoutRenderer: ServerDefinition = withTools([
  { ...getRaw, renderData: undefined, textBudget: undefined } as ToolDefinition,
]);

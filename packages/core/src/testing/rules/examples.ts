import { z } from "zod";
import { envelope, type EnvelopeInput, EnvelopeSchema } from "../../envelope/index.js";
import type { ToolDefinition, ToolHandlerResult } from "../../server/definition.js";
import type { ContractRule, RuleContext, Violation } from "../types.js";

/**
 * Every tool is exercised through its own documented examples: the input must
 * parse with the tool's schema, the handler must resolve, and the result must
 * wrap into an envelope that parses with `EnvelopeSchema`.
 *
 * Handlers run directly rather than over a transport, because the shell (#6) is
 * built in parallel; the shell adds annotations and the MCP framing, not the
 * envelope shape checked here. Handlers may hit recorded fixtures — the Vitest
 * config sets `FIXTURES=replay`, so no test touches an agency.
 */

export const examplesRule: ContractRule = {
  ids: ["examples-run", "slow-example"],
  run: async (context) => {
    const violations: Violation[] = [];
    for (const tool of context.definition.tools) {
      violations.push(...(await checkTool(tool, context)));
    }
    return violations;
  },
};

// biome-ignore lint/suspicious/noExplicitAny: the seam types the tool list heterogeneously.
type AnyTool = ToolDefinition<any, any>;

async function checkTool(tool: AnyTool, context: RuleContext): Promise<Violation[]> {
  const violations: Violation[] = [];
  const examples = tool.examples ?? [];
  if (examples.length === 0) {
    return [
      {
        rule: "examples-run",
        tool: tool.name,
        message:
          "no examples; every tool needs at least one worked input the contract suite can call it with",
      },
    ];
  }

  for (const example of examples) {
    const parsed = tool.input.safeParse(example.input);
    if (!parsed.success) {
      violations.push({
        rule: "examples-run",
        tool: tool.name,
        message: `example ${JSON.stringify(example.title)} does not parse with the tool's own input schema: ${z.prettifyError(parsed.error).replace(/\n+/g, "; ")}`,
      });
      continue;
    }

    const startedAt = Date.now();
    let result: ToolHandlerResult;
    try {
      result = await tool.handler(parsed.data, {
        now: context.now,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      });
    } catch (error) {
      violations.push({
        rule: "examples-run",
        tool: tool.name,
        message: `example ${JSON.stringify(example.title)} threw: ${errorText(error)}`,
      });
      continue;
    }
    const elapsedMs = Date.now() - startedAt;

    const wrapped = wrap(result, context.now());
    if (wrapped === undefined) {
      violations.push({
        rule: "examples-run",
        tool: tool.name,
        message: `example ${JSON.stringify(example.title)} did not return a ToolHandlerResult object`,
      });
      continue;
    }
    const envelopeResult = EnvelopeSchema.safeParse(wrapped);
    if (!envelopeResult.success) {
      violations.push({
        rule: "examples-run",
        tool: tool.name,
        message: `example ${JSON.stringify(example.title)} produced a result that is not a valid envelope: ${z.prettifyError(envelopeResult.error).replace(/\n+/g, "; ")}`,
      });
    }

    if (elapsedMs > context.slowExampleMs) {
      violations.push({
        rule: "slow-example",
        tool: tool.name,
        message: `example ${JSON.stringify(example.title)} took ${elapsedMs} ms, over the ${context.slowExampleMs} ms budget; record a fixture or narrow the example`,
      });
    }
  }
  return violations;
}

/** Wraps a handler result the way the shell does, or `undefined` if it is not one. */
function wrap(result: ToolHandlerResult, now: Date): unknown {
  if (typeof result !== "object" || result === null) {
    return undefined;
  }
  const input: EnvelopeInput<unknown> = {
    data: result.data,
    source: result.source,
    now,
    ...(result.place === undefined ? {} : { place: result.place }),
    ...(result.vintage === undefined ? {} : { vintage: result.vintage }),
    ...(result.footnotes === undefined ? {} : { footnotes: [...result.footnotes] }),
    ...(result.limitations === undefined ? {} : { limitations: [...result.limitations] }),
    ...(result.cache === undefined ? {} : { cache: result.cache }),
  };
  return envelope(input);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { EnvelopeSchema } from "../../envelope/index.js";
import { LimitExceededError } from "../../limits/limiter.js";
import { createServer } from "../../server/create-server.js";
import type { ServerDefinition, ToolDefinition } from "../../server/definition.js";
import type { ContractRule, Violation } from "../types.js";

/**
 * `refusal-shape` (ADR-020 §4, #323): what a host sees when a call is refused. Every tool of the
 * definition is mounted on the real shell with a handler that throws `LimitExceededError`, called
 * over an in-memory MCP transport with its first valid example, and the result must carry
 * `isError`, a non-empty sentence, and an envelope whose `limit` block is valid. A refusal is the
 * shell's to render, so this holds for any server the shell builds; the rule keeps it that way.
 */
export const refusalShapeRule: ContractRule = {
  ids: ["refusal-shape"],
  run: async ({ definition }) => {
    const callable = definition.tools
      .map((tool) => ({ tool, example: firstValidExample(tool) }))
      // A tool with no valid example is reported by examples-run; nothing to call here.
      .filter(
        (each): each is { tool: AnyTool; example: Record<string, unknown> } => !!each.example,
      );
    if (callable.length === 0) return [];

    const refusing: ServerDefinition = {
      ...definition,
      tools: definition.tools.map((tool) => ({ ...tool, handler: refuse(definition.agency) })),
    };
    let server: ReturnType<typeof createServer>;
    try {
      // `limits: {}` so the rule never reads the deployment's FEDERAL_MCPS_LIMITS.
      server = createServer(refusing, { limits: {} });
    } catch {
      // A definition the shell cannot mount (a duplicate or reserved tool name) is reported by
      // the naming and source rules; there is no refusal to check.
      return [];
    }
    const client = new Client({ name: "contract-refusal", version: "0.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const violations: Violation[] = [];
    try {
      for (const { tool, example } of callable) {
        const result = await client.callTool({ name: tool.name, arguments: example });
        for (const problem of checkRefusalResult(result)) {
          violations.push({ rule: "refusal-shape", tool: tool.name, message: problem });
        }
      }
    } finally {
      await client.close();
    }
    return violations;
  },
};

// biome-ignore lint/suspicious/noExplicitAny: the seam types the tool list heterogeneously.
type AnyTool = ToolDefinition<any, any>;

function firstValidExample(tool: AnyTool): Record<string, unknown> | undefined {
  return (tool.examples ?? []).find((example) => tool.input.safeParse(example.input).success)
    ?.input;
}

function refuse(agency: string): () => Promise<never> {
  return async () => {
    throw new LimitExceededError({
      scope: "network",
      kind: "upstream",
      source: agency,
      limit: 100,
      used: 100,
      resetsAt: "2026-01-02T00:00:00.000Z",
    });
  };
}

/**
 * The problems with one refusal as a host receives it (`tools/call` result); empty when it is
 * well-formed: `isError: true`, a non-empty first text block, and `structuredContent` that parses
 * as an envelope carrying a `limit` block.
 */
export function checkRefusalResult(result: unknown): string[] {
  const problems: string[] = [];
  const r = (result ?? {}) as {
    isError?: unknown;
    content?: { type?: string; text?: string }[];
    structuredContent?: unknown;
  };
  if (r.isError !== true) problems.push("a refusal must be marked isError: true");
  const text = Array.isArray(r.content) ? r.content[0]?.text : undefined;
  if (typeof text !== "string" || text.trim() === "") {
    problems.push("a refusal must say, in one plain sentence, what was limited and when it resets");
  }
  const parsed = EnvelopeSchema.safeParse(r.structuredContent);
  if (!parsed.success) {
    problems.push(
      `a refusal's structuredContent must be a valid envelope: ${z.prettifyError(parsed.error).replace(/\n+/g, "; ")}`,
    );
  } else if (parsed.data.limit === undefined) {
    problems.push("a refusal's envelope must carry a limit block");
  }
  return problems;
}

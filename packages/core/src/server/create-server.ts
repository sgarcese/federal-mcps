import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { buildCitation, EnvelopeSchema, type Source } from "../envelope/index.js";
import {
  describeSourceToolName,
  type ServerDefinition,
  type SourceDescription,
  type ToolDefinition,
} from "./definition.js";
import { toToolError } from "./errors.js";
import { wrapResult } from "./wrap.js";

/**
 * The server shell (#6): one declarative `ServerDefinition` in, one configured
 * `McpServer` out. Every agency package in the family goes through here, which
 * is how the conventions in ADR-001 §3 are enforced by code rather than by a
 * style guide (docs/architecture.md, "The shared core").
 *
 * What the shell owns, and no agency server may override:
 *
 * - **Annotations.** Every tool is read-only, non-destructive and open-world.
 *   `ToolDefinition` has no `annotations` field on purpose.
 * - **The envelope.** Handlers return plain data plus provenance; the shell
 *   wraps it (`wrap.ts`) so no server can ship a bare number.
 * - **Error shape.** Handlers throw; the shell renders (`errors.ts`).
 * - **`describe_source`.** Registered automatically from `describeSource()`,
 *   so every server in the family answers the same question the same way.
 */

/**
 * The family's tool annotations (ADR-001 §3).
 *
 * `openWorldHint: true` because every tool reaches a remote agency API whose
 * answer can change between calls; `readOnlyHint`/`destructiveHint` because
 * this family only ever reads published statistics.
 */
export const FAMILY_TOOL_ANNOTATIONS: Readonly<ToolAnnotations> = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
});

export interface CreateServerOptions {
  /**
   * Clock, injectable for tests. One call per tool invocation supplies both
   * the envelope's `retrievedAt` and the citation date, so they can never
   * disagree.
   */
  readonly now?: () => Date;
}

/** The `source` block for the auto-registered `describe_source` tool. */
function describeSourceProvenance(description: SourceDescription, retrievedAt: Date): Source {
  // `describe_source` returns no measurements, so there are no series ids; the
  // "program" slot names the tool itself and the URL is the agency homepage.
  const parts = {
    agency: description.agency,
    program: "describe_source",
    ids: [] as string[],
    url: description.homepage,
  };
  return { ...parts, citation: buildCitation(parts, retrievedAt) };
}

/**
 * Builds a configured MCP server from a definition. The returned server is not
 * connected to anything: pass it to `runStdio` (local hosts) or
 * `createHttpHandler` (Lambda, or a local `node:http` server).
 */
export function createServer(
  definition: ServerDefinition,
  options?: CreateServerOptions,
): McpServer {
  const now = options?.now ?? (() => new Date());

  const server = new McpServer(
    { name: definition.name, version: definition.version },
    // Passed through to `initialize` so hosts can surface them to the model.
    { instructions: definition.instructions },
  );

  for (const tool of definition.tools) {
    registerDefinitionTool(server, definition, tool, now);
  }

  registerDescribeSource(server, definition, now);

  return server;
}

function registerDefinitionTool(
  server: McpServer,
  definition: ServerDefinition,
  // biome-ignore lint/suspicious/noExplicitAny: the seam types the tool list heterogeneously; each tool is typed at its definition site.
  tool: ToolDefinition<any, any>,
  now: () => Date,
): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      // The tool's own Zod schema is handed to the SDK whole: it publishes the
      // JSON Schema on `tools/list` AND validates arguments before the handler
      // runs, so the shell never re-implements input validation.
      inputSchema: tool.input,
      // Advertising the envelope as the output schema is what makes
      // `structuredContent` meaningful to a host. `EnvelopeSchema` leaves
      // `data` as `unknown`; the provenance fields around it are fixed.
      outputSchema: EnvelopeSchema,
      annotations: { ...FAMILY_TOOL_ANNOTATIONS },
    },
    async (
      args: unknown,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
    ): Promise<CallToolResult> => {
      try {
        const result = await tool.handler(args, {
          now,
          ...(extra.signal === undefined ? {} : { signal: extra.signal }),
        });
        return asCallToolResult(wrapResult(result, now()));
      } catch (error) {
        return asCallToolResult(
          toToolError(error, { agency: definition.agency, toolName: tool.name }),
        );
      }
    },
  );
}

function registerDescribeSource(
  server: McpServer,
  definition: ServerDefinition,
  now: () => Date,
): void {
  const name = describeSourceToolName(definition.agency);
  server.registerTool(
    name,
    {
      description:
        "Coverage, release cadence, caveats and citation format for this source. " +
        "Read this before interpreting any number from this server.",
      // An empty raw shape, not an omitted schema: hosts then see a tool that
      // takes an object with no properties rather than one with no schema.
      inputSchema: {},
      outputSchema: EnvelopeSchema,
      annotations: { ...FAMILY_TOOL_ANNOTATIONS },
    },
    async (): Promise<CallToolResult> => {
      try {
        const retrievedAt = now();
        const description = definition.describeSource();
        return asCallToolResult(
          wrapResult(
            { data: description, source: describeSourceProvenance(description, retrievedAt) },
            retrievedAt,
          ),
        );
      } catch (error) {
        return asCallToolResult(toToolError(error, { agency: definition.agency, toolName: name }));
      }
    },
  );
}

/**
 * The SDK types `structuredContent` as `Record<string, unknown>`, which the
 * `Envelope` interface is not assignable to (interfaces get no implicit index
 * signature). The values are structurally identical, so this is a widening
 * assertion, not a change of shape — and it is confined to this one function.
 */
function asCallToolResult(result: {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
}): CallToolResult {
  return result as unknown as CallToolResult;
}

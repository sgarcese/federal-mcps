import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { buildCitation, EnvelopeSchema, type Source } from "../envelope/index.js";
import { STALE_SERVED_NOTE_PREFIX } from "../http/client.js";
import { LIMITS_ENV, type LimitsConfig, parseLimitsConfig } from "../limits/config.js";
import { currentCall, runInCall } from "../limits/context.js";
import type { Limiter } from "../limits/limiter.js";
import { ATTESTATION_HEADER, isAttested } from "./attestation.js";
import { type Caller, type Identify, SOURCE_IP_HEADER } from "./caller.js";
import {
  describeSourceToolName,
  type ServerDefinition,
  type SourceDescription,
  type ToolDefinition,
} from "./definition.js";
import { refusalLimit, type ToolErrorContext, toToolError } from "./errors.js";
import { identifyFromEnv } from "./identify.js";
import { logToolCallMetric } from "./metrics.js";
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
  /**
   * Turns a request's headers into the caller (ADR-020 §1), injectable for tests. Called only
   * for requests our Lambda adapter attested (attestation.ts); any other request has no caller.
   * Default: `identifyFromEnv()`, built on the first attested request that carries a source
   * address, so stdio and local runs never read the secret or warn about its absence.
   */
  readonly identify?: Identify;
  /** Counts and refuses tool calls per caller (ADR-020 §2, #322). Default: no limiter. */
  readonly limiter?: Limiter;
  /**
   * The configured limits `describe_source` reports (ADR-020 §4, #323). Default: parsed from
   * `FEDERAL_MCPS_LIMITS` when the server is created; absent means no `limits` block.
   */
  readonly limits?: LimitsConfig;
}

/** The `limits` block `describe_source` answers with (ADR-020 §4). */
export interface SourceLimits {
  /** Daily shares for one network, as configured. */
  readonly network?: NonNullable<LimitsConfig["network"]>;
  /** Daily shares for all claude.ai users together, as configured. */
  readonly pool?: NonNullable<LimitsConfig["pool"]>;
  /** Per upstream budget key: the daily budget, and today's use when a limiter counts it. */
  readonly service?: Readonly<Record<string, ServiceBudget>>;
}

/** One service budget in `describe_source`'s `limits` block. */
export interface ServiceBudget {
  readonly daily: number;
  readonly used?: number;
  readonly remaining?: number;
  readonly resetsAt?: string;
}

/** Builds `describe_source`'s `limits` block from the configuration and the limiter's counts. */
async function sourceLimits(
  config: LimitsConfig,
  limiter: Limiter | undefined,
  at: Date,
): Promise<SourceLimits> {
  const service: Record<string, ServiceBudget> = {};
  for (const [source, daily] of Object.entries(config.serviceDaily ?? {})) {
    const usage = await limiter?.usage(source, at);
    service[source] =
      usage === undefined
        ? { daily }
        : {
            daily,
            used: usage.used,
            remaining: Math.max(0, usage.limit - usage.used),
            resetsAt: usage.resetsAt,
          };
  }
  return {
    ...(config.network === undefined ? {} : { network: config.network }),
    ...(config.pool === undefined ? {} : { pool: config.pool }),
    ...(Object.keys(service).length === 0 ? {} : { service }),
  };
}

/** What a refusal needs from the definition: its homepage and every tool name (errors.ts). */
function errorContext(definition: ServerDefinition, toolName: string, at: Date): ToolErrorContext {
  let homepage: string | undefined;
  try {
    homepage = definition.describeSource().homepage;
  } catch {
    homepage = undefined;
  }
  return {
    agency: definition.agency,
    toolName,
    tools: definition.tools.map((tool) => tool.name),
    now: at,
    ...(homepage === undefined ? {} : { homepage }),
  };
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Builds the per-call caller from the HTTP request behind a tool call, if there is one. */
type CallerFor = (extra: Extra) => Caller | undefined;

function callerResolver(options: CreateServerOptions | undefined, now: () => Date): CallerFor {
  let fromEnv: Identify | undefined;
  const identify: Identify =
    options?.identify ??
    ((headers, at) => {
      if (!headers[SOURCE_IP_HEADER]) return undefined;
      fromEnv ??= identifyFromEnv();
      return fromEnv(headers, at);
    });
  return (extra) => {
    // Stdio (and the in-memory transport) carry no HTTP request, so there is no caller.
    const raw = extra.requestInfo?.headers;
    if (raw === undefined) return undefined;
    const headers = normalizeHeaders(raw);
    // A source address counts only when our Lambda adapter, in this process, attested it
    // (attestation.ts). A client that reaches the handler directly and sends the header itself
    // gets no caller, silently, and identify() is never consulted. The nonce stops here.
    const attested = isAttested(headers);
    delete headers[ATTESTATION_HEADER];
    if (!attested) return undefined;
    return identify(headers, now());
  };
}

/** Lower-cased names; a repeated header joined the way Node and fetch join one. */
function normalizeHeaders(
  raw: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
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
  const callerFor = callerResolver(options, now);

  const server = new McpServer(
    { name: definition.name, version: definition.version },
    // Passed through to `initialize` so hosts can surface them to the model.
    { instructions: definition.instructions },
  );

  for (const tool of definition.tools) {
    registerDefinitionTool(server, definition, tool, now, callerFor, options?.limiter);
  }

  // Read once, at cold start: a malformed value throws here, loudly (config.ts).
  const limits = options?.limits ?? parseLimitsConfig(process.env[LIMITS_ENV]);
  registerDescribeSource(server, definition, now, limits, options?.limiter);

  for (const resource of definition.resources ?? []) {
    server.registerResource(
      resource.name,
      resource.uri,
      { description: resource.description, mimeType: resource.mimeType },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: resource.mimeType, text: resource.read() }],
      }),
    );
  }

  return server;
}

function registerDefinitionTool(
  server: McpServer,
  definition: ServerDefinition,
  // biome-ignore lint/suspicious/noExplicitAny: the seam types the tool list heterogeneously; each tool is typed at its definition site.
  tool: ToolDefinition<any, any>,
  now: () => Date,
  callerFor: CallerFor,
  limiter: Limiter | undefined,
): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
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
    async (args: unknown, extra: Extra): Promise<CallToolResult> => {
      // Wall-clock timing for the metrics line (#326, ADR-020 §5): a real clock, never the
      // injectable `now` (which tests often fix, which would make every call read 0ms).
      const startedAtMs = Date.now();
      let caller: Caller | undefined;
      let upstreamCalls = 0;
      try {
        caller = callerFor(extra);
        // Each call runs in its own context (ADR-020 seam): the HTTP client reads the caller from
        // it, and notes left there (e.g. a budget warning) follow the handler's own limitations.
        const result = await runInCall(caller === undefined ? {} : { caller }, async () => {
          // The caller's tool-call share (#322, ADR-020 §2): a refusal throws before the handler.
          await limiter?.beginToolCall(caller, now());
          const handled = await tool.handler(args, {
            now,
            ...(extra.signal === undefined ? {} : { signal: extra.signal }),
            ...(caller === undefined ? {} : { caller }),
          });
          const notes = currentCall()?.notes ?? [];
          upstreamCalls = currentCall()?.upstreamCalls.count ?? 0;
          return notes.length === 0
            ? handled
            : { ...handled, limitations: [...(handled.limitations ?? []), ...notes] };
        });
        // A refusal served from stale cache (the HTTP client's `STALE_SERVED_NOTE_PREFIX` note)
        // is a successful call, but "stale" rather than a plain "ok" for the metrics line.
        const stale = (result.limitations ?? []).some((note: string) =>
          note.startsWith(STALE_SERVED_NOTE_PREFIX),
        );
        logToolCallMetric({
          server: definition.agency,
          tool: tool.name,
          outcome: stale ? "stale" : "ok",
          latencyMs: Date.now() - startedAtMs,
          upstreamCalls,
          ...(stale ? { cacheHit: true } : {}),
          callerKind: caller?.kind ?? "none",
          ...(caller?.labels.userAgent === undefined ? {} : { userAgent: caller.labels.userAgent }),
        });
        return asCallToolResult(
          wrapResult(result, now(), { renderData: tool.renderData, textBudget: tool.textBudget }),
        );
      } catch (error) {
        const limit = refusalLimit(error);
        logToolCallMetric({
          server: definition.agency,
          tool: tool.name,
          outcome: limit === undefined ? "error" : "refused",
          latencyMs: Date.now() - startedAtMs,
          upstreamCalls,
          callerKind: caller?.kind ?? "none",
          ...(limit === undefined ? {} : { limitScope: limit.scope }),
          ...(caller?.labels.userAgent === undefined ? {} : { userAgent: caller.labels.userAgent }),
        });
        return asCallToolResult(toToolError(error, errorContext(definition, tool.name, now())));
      }
    },
  );
}

function registerDescribeSource(
  server: McpServer,
  definition: ServerDefinition,
  now: () => Date,
  limits: LimitsConfig | undefined,
  limiter: Limiter | undefined,
): void {
  const name = describeSourceToolName(definition.agency);
  server.registerTool(
    name,
    {
      title: "Describe source",
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
        // With a limits configuration, the answer also says what the limits are (ADR-020 §4).
        const data =
          limits === undefined
            ? description
            : { ...description, limits: await sourceLimits(limits, limiter, retrievedAt) };
        return asCallToolResult(
          wrapResult(
            { data, source: describeSourceProvenance(description, retrievedAt) },
            retrievedAt,
          ),
        );
      } catch (error) {
        return asCallToolResult(toToolError(error, errorContext(definition, name, now())));
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

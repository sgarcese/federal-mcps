import type { z } from "zod";
import type { CacheInfo } from "../cache.js";
import type { Footnote, PlaceRef, Source } from "../envelope/index.js";

/**
 * The declarative server definition (wave 3 seam).
 *
 * `createServer(definition)` (#6) turns one of these into a configured MCP
 * server with both transports; `assertFamilyContract(definition)` (#7) checks
 * it against ADR-001 §3 and ADR-003 §8. Both consume these types; neither
 * redefines them. Agency packages (`server-bls`, #8) author one definition.
 */

/** What `describe_source` reports. Written for the model, not the developer. */
export interface SourceDescription {
  /** Agency code, e.g. "bls". Also the tool-name prefix. */
  readonly agency: string;
  /** Display name for citations, e.g. "U.S. Bureau of Labor Statistics". */
  readonly agencyName: string;
  readonly homepage: string;
  /** Programs this server covers, with the local granularity each publishes at. */
  readonly programs: readonly ProgramDescription[];
  /** Upstream quota and cadence notes, e.g. "500 queries per day with a key". */
  readonly quota?: string;
  /** Things the model must not get wrong, e.g. "most cities have no local CPI". */
  readonly caveats: readonly string[];
  /** How to cite a number from this source; the envelope's `source.citation` follows it. */
  readonly citationFormat: string;
}

export interface ProgramDescription {
  /** Program code as the agency uses it, e.g. "LAUS", "SM", "QCEW". */
  readonly code: string;
  readonly name: string;
  /** Geographic levels published, in the model's words: "state, metro, county, city ≥25k". */
  readonly granularity: string;
  /** Release cadence: "monthly", "quarterly", "annual". */
  readonly cadence: string;
  /** Whether this server already serves it. Release 1 marks programs as they land (M3–M5). */
  readonly status: "available" | "planned";
}

/** A worked input the contract harness calls the tool with (#7). At least one per tool. */
export interface ToolExample {
  readonly title: string;
  readonly input: Record<string, unknown>;
}

/**
 * What a tool handler returns. The shell wraps it in the provenance envelope
 * (#4): `footnotes`/`limitations` default to `[]`, `cache` to the HTTP client's
 * report or a miss, `retrievedAt` to now.
 */
export interface ToolHandlerResult<TData = unknown> {
  readonly data: TData;
  readonly source: Source;
  readonly place?: PlaceRef;
  readonly vintage?: string;
  readonly footnotes?: readonly Footnote[];
  readonly limitations?: readonly string[];
  readonly cache?: CacheInfo;
}

/** Per-call context the shell hands to handlers. */
export interface ToolContext {
  readonly signal?: AbortSignal;
  /** Clock, injectable for tests. */
  readonly now: () => Date;
}

/**
 * One tool. `name` is the full MCP tool name including the agency prefix
 * (`bls_get_unemployment`); the harness checks prefix, length and verb
 * conformance. Annotations are NOT part of the definition: the shell sets
 * `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true` on
 * every tool (ADR-001 §3).
 */
export interface ToolDefinition<TInput extends z.ZodType = z.ZodType, TData = unknown> {
  readonly name: string;
  /**
   * Human-readable title hosts show next to the name (`title` on `tools/list`). Required:
   * the Anthropic connector directory rejects tools without one (#138).
   */
  readonly title: string;
  readonly description: string;
  readonly input: TInput;
  readonly examples: readonly [ToolExample, ...ToolExample[]];
  readonly handler: (
    input: z.output<TInput>,
    context: ToolContext,
  ) => Promise<ToolHandlerResult<TData>>;
  /**
   * True for a tool produced by `core.geographyTools()`. The contract harness allows a
   * `*_resolve_place` tool only when this is set — servers must not ship their own place
   * lookup (ADR-003 §8), but may mount core's.
   */
  readonly fromCore?: boolean;
}

/** A read-only MCP resource a server exposes (e.g. `geography://guide`). */
export interface ResourceDefinition {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
  /** Returns the resource body. Called when a host reads the URI. */
  readonly read: () => string;
}

/** The whole server, declaratively. */
export interface ServerDefinition {
  /** MCP server name reported on `initialize`, e.g. "federal-mcps-bls". */
  readonly name: string;
  readonly version: string;
  /** Agency code; every tool name must start with `${agency}_`. */
  readonly agency: string;
  /** Server instructions passed to the SDK so hosts surface them to the model. */
  readonly instructions: string;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous tool list; each tool is typed at its definition site.
  readonly tools: readonly ToolDefinition<any, any>[];
  /** Read-only resources to register (e.g. the geography guide). Optional. */
  readonly resources?: readonly ResourceDefinition[];
  /** Backs the auto-registered `${agency}_describe_source` tool. */
  readonly describeSource: () => SourceDescription;
}

/** The tool the shell registers on every server from `describeSource()`. */
export function describeSourceToolName(agency: string): string {
  return `${agency}_describe_source`;
}

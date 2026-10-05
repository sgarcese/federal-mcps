import { buildCitation, type Envelope, type EnvelopeLimit, envelope } from "../envelope/index.js";
import {
  HttpError,
  MissingFixtureError,
  NetworkError,
  QuotaExceededError,
  TimeoutError,
} from "../http/index.js";
import { LimitExceededError } from "../limits/limiter.js";

/**
 * Turning a thrown handler error into an MCP tool error (#6).
 *
 * Two rules shape everything here:
 *
 * 1. **A stack trace is never sent to a model.** It is noise in the context
 *    window, it leaks file paths from the deployment, and it tells the caller
 *    nothing actionable. Only `error.message` is used, and only its first
 *    line, so an error that carries an embedded trace still cannot smuggle one
 *    through.
 * 2. **The message is uniform: `<agency>: <what failed> (<url or tool name>)`.**
 *    The agency prefix matters in the composite server, where several agencies'
 *    tools answer in one conversation and "request failed" alone is useless.
 *    The parenthetical is the failing URL when the error knows one, and the
 *    tool name otherwise, so the model can retry or narrow the right thing.
 *
 * Zod input-validation failures are NOT handled here: the SDK validates
 * `inputSchema` before the handler runs and returns its own `InvalidParams`
 * error. Re-implementing that would produce two different messages for the
 * same mistake.
 */

/** What the shell knows about the call that failed. */
export interface ToolErrorContext {
  /** Agency code from the server definition, e.g. "bls". */
  readonly agency: string;
  /** Full tool name, e.g. "bls_get_unemployment". */
  readonly toolName: string;
  /** The agency homepage, for a refusal's `source.url` (from `describeSource()`). */
  readonly homepage?: string;
  /** Every tool the server registers, so a refusal names only tools it has. */
  readonly tools?: readonly string[];
  /** The refusal envelope's `retrievedAt`; default now. */
  readonly now?: Date;
}

/** The MCP error result shape this module produces. */
export interface ToolErrorResult {
  readonly isError: true;
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  /** On refusals only (ADR-020 §4): an envelope with `data: null` and the `limit` block. */
  readonly structuredContent?: Envelope<null>;
}

/**
 * The `limit` block for an error that is a refusal (ADR-020 §4), or undefined for any other error.
 * The limiter's `LimitExceededError` carries its facts; core's `QuotaExceededError` (the per-source
 * budget, or an agency's own daily refusal) is the whole service's budget of upstream queries.
 */
export function refusalLimit(error: unknown): EnvelopeLimit | undefined {
  if (error instanceof LimitExceededError) {
    return { ...error.info };
  }
  if (error instanceof QuotaExceededError) {
    return {
      scope: "service",
      kind: "upstream",
      source: error.source,
      ...(error.limit === undefined ? {} : { limit: error.limit }),
      ...(error.used === undefined ? {} : { used: error.used }),
      resetsAt: error.resetsAt,
    };
  }
  return undefined;
}

/** How a refusal names an upstream budget key; an unknown key is named as-is. */
const UPSTREAM_NAMES: Readonly<Record<string, string>> = Object.freeze({
  bls: "BLS",
  "bls-qcew": "QCEW",
  census: "Census",
  hud: "HUD User",
  bea: "BEA",
});

/** The tools a refusal of upstream queries leaves working: they never query the agency. */
const NO_QUERY_VERBS = ["resolve_place", "list_indicators", "describe_source"] as const;

/**
 * The refusal's one plain sentence (ADR-020 §4): what was limited, whose share it was, the number
 * and the reset time, and, for upstream queries, which of the server's tools still work. A count
 * the refuser did not give (an agency's own refusal) is left out rather than invented.
 */
export function refusalSentence(
  limit: EnvelopeLimit,
  agency: string,
  tools?: readonly string[],
): string {
  const what =
    limit.kind === "upstream"
      ? `${UPSTREAM_NAMES[limit.source ?? ""] ?? limit.source ?? "upstream"} queries`
      : "tool calls";
  const n = limit.limit === undefined ? "" : `${limit.limit} `;
  const whose =
    limit.scope === "network"
      ? `this network has used its ${n}${what} for today`
      : limit.scope === "pool"
        ? `all claude.ai users together have used their shared ${n}${what} for today`
        : limit.limit === undefined
          ? `the whole service's daily budget of ${what} is spent`
          : `the whole service has used its daily budget of ${n}${what}`;
  let sentence = `${agency}: ${whose}; resets at ${limit.resetsAt}.`;
  if (limit.kind === "upstream") {
    const describeSource = `${agency}_describe_source`;
    const working = NO_QUERY_VERBS.map((verb) => `${agency}_${verb}`).filter(
      // describe_source is registered by the shell on every server, so it is always there.
      (name) => tools === undefined || name === describeSource || tools.includes(name),
    );
    sentence += ` Tools that need no new query (${working.join(", ")}) still work.`;
  }
  return sentence;
}

function toRefusal(limit: EnvelopeLimit, context: ToolErrorContext): ToolErrorResult {
  const text = refusalSentence(limit, context.agency, context.tools);
  const now = context.now ?? new Date();
  // A refusal fetched nothing: the "program" slot names the refused tool (as describe_source's
  // names itself), and the URL is the agency homepage.
  const parts = {
    agency: context.agency,
    program: context.toolName,
    ids: [] as string[],
    url: context.homepage ?? "",
  };
  const structuredContent = envelope<null>({
    data: null,
    source: { ...parts, citation: buildCitation(parts, now) },
    limitations: [text],
    limit,
    now,
  });
  return { isError: true, content: [{ type: "text", text }], structuredContent };
}

/** Keeps a message to its first line, so an embedded trace cannot ride along. */
function firstLine(message: string): string {
  const [line] = message.split("\n");
  return (line ?? "").trim();
}

/**
 * Describes what failed and where, for one error. Returns the two halves of
 * the message: `what` (never a stack, never multi-line) and `where` (a URL
 * when the error knows one).
 */
function describe(error: unknown): { what: string; where?: string } {
  if (error instanceof HttpError) {
    return {
      what: `request failed with HTTP ${error.status} after ${error.attempts} attempt(s)`,
      where: error.url,
    };
  }
  if (error instanceof TimeoutError) {
    return { what: `request timed out after ${error.timeoutMs}ms`, where: error.url };
  }
  if (error instanceof NetworkError) {
    return { what: "network error reaching the agency", where: error.url };
  }
  if (error instanceof MissingFixtureError) {
    return { what: "no recorded fixture for this request", where: error.url };
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return { what: firstLine(error.message) };
  }
  // A thrown string, object or empty-message Error: say so plainly rather
  // than stringifying something the model cannot act on.
  return { what: "the tool call failed" };
}

/**
 * Maps a thrown handler error to an MCP tool error result. The agency comes
 * from the server definition rather than the error, so every tool on a server
 * reports the same name even when a helper throws a generic `Error`.
 */
export function toToolError(error: unknown, context: ToolErrorContext): ToolErrorResult {
  const limit = refusalLimit(error);
  if (limit !== undefined) return toRefusal(limit, context);
  const { what, where } = describe(error);
  const text = `${context.agency}: ${what} (${where ?? context.toolName})`;
  return { isError: true, content: [{ type: "text", text }] };
}

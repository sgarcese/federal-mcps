import {
  HttpError,
  MissingFixtureError,
  NetworkError,
  QuotaExceededError,
  TimeoutError,
} from "../http/index.js";

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
}

/** The MCP error result shape this module produces. */
export interface ToolErrorResult {
  readonly isError: true;
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
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
  if (error instanceof QuotaExceededError) {
    // The reset time is the actionable part: it tells the caller (or its
    // human) when to try again rather than to retry immediately and fail.
    return { what: `daily quota exceeded, resets at ${error.resetsAt}` };
  }
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
  const { what, where } = describe(error);
  const text = `${context.agency}: ${what} (${where ?? context.toolName})`;
  return { isError: true, content: [{ type: "text", text }] };
}

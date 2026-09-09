import { type Envelope, envelope } from "../envelope/index.js";
import type { ToolHandlerResult } from "./definition.js";

/**
 * How a handler result becomes an MCP tool result (#6).
 *
 * Two representations travel together on every successful call:
 *
 * - `structuredContent` — the full provenance envelope (#4). This is the
 *   machine-readable answer and it is never abridged: hosts that understand
 *   `outputSchema` read numbers, place and citation from here.
 * - `content[0].text` — a compact rendering for hosts (and models) that only
 *   read text. It is deliberately lossy: a header line, the data as JSON
 *   truncated to `MAX_RENDERED_DATA_CHARS`, then footnotes and limitations.
 *
 * The text rendering leads with provenance rather than data because the
 * family's whole point is that a number arrives with its place, source and
 * retrieval time attached; a model that reads only the first line still knows
 * what it is looking at.
 */

/**
 * Character budget for the JSON data line in the text rendering. Large series
 * responses would otherwise dominate the model's context for no benefit — the
 * whole value is in `structuredContent`, which is never truncated.
 */
export const MAX_RENDERED_DATA_CHARS = 4000;

/** The MCP tool result shape this module produces. */
export interface WrappedToolResult<T> {
  readonly content: readonly [{ readonly type: "text"; readonly text: string }];
  readonly structuredContent: Envelope<T>;
}

/**
 * Renders an envelope as compact text. One header line naming the place (when
 * one was resolved), the agency, program, series/variable ids and the
 * retrieval timestamp; the data as JSON; then one bullet per footnote and per
 * limitation, so caveats are never silently dropped (CLAUDE.md, "Numbers carry
 * their caveats").
 */
export function renderText(env: Envelope<unknown>): string {
  const { place, source, retrievedAt, footnotes, limitations } = env;
  const idSegment = source.ids.length > 0 ? ` [${source.ids.join(", ")}]` : "";
  const placeSegment = place ? `${place.name} — ` : "";
  const header = `${placeSegment}${source.agency} ${source.program}${idSegment} — retrieved ${retrievedAt}`;

  const lines: string[] = [header];

  // `undefined` data (a handler may legitimately return it) stringifies to
  // `undefined`, not a string; render it as JSON null instead of "undefined".
  const json = JSON.stringify(env.data) ?? "null";
  if (json.length > MAX_RENDERED_DATA_CHARS) {
    lines.push(json.slice(0, MAX_RENDERED_DATA_CHARS));
    lines.push(
      `… truncated at ${MAX_RENDERED_DATA_CHARS} of ${json.length} characters; ` +
        "the whole value is in structuredContent.",
    );
  } else {
    lines.push(json);
  }

  for (const footnote of footnotes) {
    lines.push(`- footnote ${footnote.code}: ${footnote.text}`);
  }
  for (const limitation of limitations) {
    lines.push(`- limitation: ${limitation}`);
  }

  return lines.join("\n");
}

/**
 * Wraps a handler's result in the provenance envelope and the MCP tool result
 * shape. `now` is passed in (rather than read here) so a single timestamp
 * covers the whole call and tests can pin it.
 */
export function wrapResult<T>(result: ToolHandlerResult<T>, now: Date): WrappedToolResult<T> {
  // Built field by field because `exactOptionalPropertyTypes` forbids passing
  // an explicit `undefined` for an optional property, and because the seam's
  // readonly arrays must be copied into the envelope's mutable ones.
  const env = envelope<T>({
    data: result.data,
    source: result.source,
    now,
    ...(result.place === undefined ? {} : { place: result.place }),
    ...(result.vintage === undefined ? {} : { vintage: result.vintage }),
    ...(result.footnotes === undefined ? {} : { footnotes: [...result.footnotes] }),
    ...(result.limitations === undefined ? {} : { limitations: [...result.limitations] }),
    ...(result.cache === undefined ? {} : { cache: result.cache }),
  });

  return { content: [{ type: "text", text: renderText(env) }], structuredContent: env };
}

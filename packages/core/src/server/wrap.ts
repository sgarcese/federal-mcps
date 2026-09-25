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

/**
 * Text budget for raw tools (`*_get_raw`, #210, ADR-017 §2): about 6,000 tokens, under common
 * host caps on a tool result, and room for a county-by-state Census pull or several years of a
 * few BLS series. Indicator tools keep `MAX_RENDERED_DATA_CHARS`.
 */
export const RAW_TEXT_BUDGET = 24_000;

/**
 * A tool's compact text form of its data (#210, ADR-017 §1): lines printed once (`head` — a
 * column header, API notes), then one entry per row or series (`items`, possibly multi-line).
 * The shell cuts on whole items within the tool's budget and reports "showing N of M <unit>"
 * with `narrowHint`, so a model knows the answer is partial and how to ask for the rest.
 */
export interface CompactRendering {
  readonly head: readonly string[];
  readonly items: readonly string[];
  readonly unit: string;
  readonly narrowHint: string;
}

/** Per-tool rendering options, from `ToolDefinition.renderData` / `textBudget`. */
export interface RenderOptions {
  // biome-ignore lint/suspicious/noExplicitAny: each tool types its own data; the shell passes it through.
  readonly renderData?: ((data: any) => CompactRendering | undefined) | undefined;
  readonly textBudget?: number | undefined;
}

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
export function renderText(env: Envelope<unknown>, options: RenderOptions = {}): string {
  const { place, source, retrievedAt, footnotes, limitations } = env;
  const budget = options.textBudget ?? MAX_RENDERED_DATA_CHARS;
  const compact = options.renderData?.(env.data);
  // A compact rendering prints its own column header, so the provenance line drops the id list
  // (it is in structuredContent's source.ids and citation): ids appear once (ADR-017 §1).
  const idSegment = !compact && source.ids.length > 0 ? ` [${source.ids.join(", ")}]` : "";
  const placeSegment = place ? `${place.name} — ` : "";
  const header = `${placeSegment}${source.agency} ${source.program}${idSegment} — retrieved ${retrievedAt}`;

  const lines: string[] = [header];

  if (compact) {
    lines.push(...renderCompact(compact, budget));
  } else {
    // `undefined` data (a handler may legitimately return it) stringifies to
    // `undefined`, not a string; render it as JSON null instead of "undefined".
    const json = JSON.stringify(env.data) ?? "null";
    if (json.length > budget) {
      lines.push(json.slice(0, budget));
      lines.push(
        `… truncated at ${budget} of ${json.length} characters; ` +
          "the whole value is in structuredContent.",
      );
    } else {
      lines.push(json);
    }
  }

  for (const footnote of footnotes) {
    lines.push(`- footnote ${footnote.code}: ${footnote.text}`);
  }
  for (const limitation of limitations) {
    lines.push(`- limitation: ${limitation}`);
  }

  return lines.join("\n");
}

/** Head lines, then whole items while they fit the budget, then a "showing N of M" notice. */
function renderCompact(r: CompactRendering, budget: number): string[] {
  const out: string[] = [...r.head];
  let used = r.head.reduce((n, line) => n + line.length + 1, 0);
  let shown = 0;
  for (const item of r.items) {
    if (used + item.length + 1 > budget) break;
    out.push(item);
    used += item.length + 1;
    shown++;
  }
  const total = r.items.length;
  if (shown === 0 && total > 0) {
    // Not even one item fits: show its start rather than nothing, and say it is partial.
    const first = r.items[0] ?? "";
    out.push(first.slice(0, Math.max(0, budget - used)));
    out.push(
      `… showing part of 1 of ${total} ${r.unit}; the whole value is in structuredContent. ${r.narrowHint}`,
    );
  } else if (shown < total) {
    out.push(
      `… showing ${shown} of ${total} ${r.unit}; the whole value is in structuredContent. ${r.narrowHint}`,
    );
  }
  return out;
}

/**
 * Wraps a handler's result in the provenance envelope and the MCP tool result
 * shape. `now` is passed in (rather than read here) so a single timestamp
 * covers the whole call and tests can pin it.
 */
export function wrapResult<T>(
  result: ToolHandlerResult<T>,
  now: Date,
  options: RenderOptions = {},
): WrappedToolResult<T> {
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

  return { content: [{ type: "text", text: renderText(env, options) }], structuredContent: env };
}

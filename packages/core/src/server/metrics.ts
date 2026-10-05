/**
 * The per-call metrics log line (#326, ADR-020 §5): one CloudWatch Embedded Metric Format
 * (EMF) JSON line per tool call, written to stdout by the shell (create-server.ts) around
 * every tool call, plus one line per upstream call whose service budget the limiter reports
 * (the HTTP client, see `logServiceBudgetMetric`).
 *
 * **Never arguments, never results, never a caller key or address.** Only the fields named
 * here — server, tool, outcome, latency, upstream-fetch count, cache hit, limit scope, the
 * caller's *class* and a truncated user-agent label — ever reach this line; `privacy.md`
 * promises exactly that (spike, "Question 4: monitoring"). `userAgent` is a log property
 * only, never a metric dimension, so it can never explode CloudWatch's dimension cardinality.
 *
 * **Gated on Lambda.** stdout is the JSON-RPC transport for stdio hosts (stdio.ts), so this
 * line must never print there. It is gated on `AWS_LAMBDA_FUNCTION_NAME` (set by the Lambda
 * runtime, never in a local or stdio run) rather than on the transport, so a local HTTP smoke
 * test behaves like stdio and a real deploy always gets the line — the simpler, one-fact test
 * than threading "is this a Lambda invocation" through every call site.
 */

/** Namespace every metric in this family is published under (ADR-020 §5). */
export const METRICS_NAMESPACE = "FederalMCPs";

/** How a tool call ended, for the `ToolCalls`/`Refusals`/`Errors` metrics and the log line. */
export type ToolCallOutcome = "ok" | "error" | "refused" | "stale";

/** Whose request this was, from `Caller.kind`, or "none" when the request carried no caller. */
export type CallerKind = "network" | "pool" | "none";

const USER_AGENT_MAX_LENGTH = 64;

export interface ToolCallMetricInput {
  readonly server: string;
  readonly tool: string;
  readonly outcome: ToolCallOutcome;
  readonly latencyMs: number;
  readonly upstreamCalls: number;
  readonly cacheHit?: boolean;
  /** Present only on a `refused` outcome (ADR-020 §4's `limit.scope`). */
  readonly limitScope?: "network" | "pool" | "service";
  readonly callerKind: CallerKind;
  readonly userAgent?: string;
  readonly now?: () => Date;
}

/** One EMF metric-definition entry: a namespace, one or more dimension sets, and its metrics. */
interface MetricDefinition {
  readonly Namespace: string;
  readonly Dimensions: readonly (readonly string[])[];
  readonly Metrics: readonly { readonly Name: string; readonly Unit: string }[];
}

/** Truncates a label to a fixed length, as `privacy.md` and the spike both promise. */
function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * Builds the EMF log line for one tool call. Exported (not just `logToolCallMetric`) so the
 * unit test can assert the exact shape without parsing stdout.
 */
export function buildToolCallMetricLine(input: ToolCallMetricInput): string {
  const now = (input.now ?? (() => new Date()))();
  const metricDefs: MetricDefinition[] = [
    // ToolCalls carries both the lean per-server rollup and the per-tool detail (ADR-020 §5),
    // as two dimension sets on one metric rather than two separate metrics.
    {
      Namespace: METRICS_NAMESPACE,
      Dimensions: [["server"], ["server", "tool"]],
      Metrics: [{ Name: "ToolCalls", Unit: "Count" }],
    },
    {
      Namespace: METRICS_NAMESPACE,
      Dimensions: [["server"]],
      Metrics: [
        { Name: "UpstreamCalls", Unit: "Count" },
        { Name: "LatencyMs", Unit: "Milliseconds" },
        ...(input.outcome === "error" ? [{ Name: "Errors", Unit: "Count" }] : []),
      ],
    },
  ];
  if (input.outcome === "refused" && input.limitScope !== undefined) {
    metricDefs.push({
      Namespace: METRICS_NAMESPACE,
      Dimensions: [["server", "limitScope"]],
      Metrics: [{ Name: "Refusals", Unit: "Count" }],
    });
  }

  const line: Record<string, unknown> = {
    _aws: { Timestamp: now.getTime(), CloudWatchMetrics: metricDefs },
    server: input.server,
    tool: input.tool,
    outcome: input.outcome,
    ToolCalls: 1,
    UpstreamCalls: input.upstreamCalls,
    LatencyMs: input.latencyMs,
    callerKind: input.callerKind,
  };
  if (input.outcome === "error") line["Errors"] = 1;
  if (input.outcome === "refused" && input.limitScope !== undefined) {
    line["limitScope"] = input.limitScope;
    line["Refusals"] = 1;
  }
  if (input.cacheHit !== undefined) line["cacheHit"] = input.cacheHit;
  const userAgent = truncate(input.userAgent, USER_AGENT_MAX_LENGTH);
  if (userAgent !== undefined) line["userAgent"] = userAgent;
  return JSON.stringify(line);
}

/** True only inside a real Lambda invocation (set by the runtime; never local or stdio). */
function onLambda(): boolean {
  return Boolean(process.env["AWS_LAMBDA_FUNCTION_NAME"]);
}

/**
 * Writes the per-call metric line to stdout, gated on Lambda (see module docs). Called by the
 * shell around every tool call (create-server.ts); never throws, so a logging mistake can
 * never turn into a failed tool call.
 */
export function logToolCallMetric(input: ToolCallMetricInput): void {
  if (!onLambda()) return;
  try {
    process.stdout.write(`${buildToolCallMetricLine(input)}\n`);
  } catch {
    // Never let a metrics-logging bug fail or mask the tool call it is describing.
  }
}

export interface ServiceBudgetMetricInput {
  readonly source: string;
  readonly usedPct: number;
  readonly now?: () => Date;
}

/** Builds the EMF log line for one `ServiceBudgetUsedPct` sample, dimensioned by `source`. */
export function buildServiceBudgetMetricLine(input: ServiceBudgetMetricInput): string {
  const now = (input.now ?? (() => new Date()))();
  const line = {
    _aws: {
      Timestamp: now.getTime(),
      CloudWatchMetrics: [
        {
          Namespace: METRICS_NAMESPACE,
          Dimensions: [["source"]],
          Metrics: [{ Name: "ServiceBudgetUsedPct", Unit: "Percent" }],
        },
      ],
    },
    source: input.source,
    ServiceBudgetUsedPct: input.usedPct,
  };
  return JSON.stringify(line);
}

/**
 * Emitted by the HTTP client whenever the limiter's `beforeUpstream` returns a usage snapshot
 * (ADR-020 §5) — i.e. whenever a source has a service budget and a real upstream fetch was
 * charged against it. Gated and guarded exactly like `logToolCallMetric`.
 */
export function logServiceBudgetMetric(input: ServiceBudgetMetricInput): void {
  if (!onLambda()) return;
  try {
    process.stdout.write(`${buildServiceBudgetMetricLine(input)}\n`);
  } catch {
    // Never let a metrics-logging bug fail or mask the upstream call it is describing.
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildServiceBudgetMetricLine,
  buildToolCallMetricLine,
  logServiceBudgetMetric,
  logToolCallMetric,
  METRICS_NAMESPACE,
} from "./metrics.js";

/**
 * The per-call EMF metric line (#326, ADR-020 §5): shape, namespace, dimensions, and the
 * privacy promise that no argument text, caller key or address ever reaches it. Also proves
 * the line is gated on Lambda, so stdio's JSON-RPC stdout stream is never touched.
 */

const NOW = () => new Date("2026-10-05T12:00:00.000Z");

describe("buildToolCallMetricLine", () => {
  it("is valid JSON carrying the required fields on a plain ok call", () => {
    const line = buildToolCallMetricLine({
      server: "bls",
      tool: "bls_get_indicator",
      outcome: "ok",
      latencyMs: 42,
      upstreamCalls: 1,
      cacheHit: false,
      callerKind: "network",
      now: NOW,
    });
    const parsed = JSON.parse(line);
    expect(parsed.server).toBe("bls");
    expect(parsed.tool).toBe("bls_get_indicator");
    expect(parsed.outcome).toBe("ok");
    expect(parsed.LatencyMs).toBe(42);
    expect(parsed.UpstreamCalls).toBe(1);
    expect(parsed.cacheHit).toBe(false);
    expect(parsed.callerKind).toBe("network");
    expect(parsed.ToolCalls).toBe(1);
  });

  it("publishes under the FederalMCPs namespace with server and server+tool dimensions for ToolCalls", () => {
    const parsed = JSON.parse(
      buildToolCallMetricLine({
        server: "hud",
        tool: "hud_get_indicator",
        outcome: "ok",
        latencyMs: 10,
        upstreamCalls: 0,
        callerKind: "pool",
        now: NOW,
      }),
    );
    const defs = parsed._aws.CloudWatchMetrics;
    expect(defs.every((d: { Namespace: string }) => d.Namespace === METRICS_NAMESPACE)).toBe(true);
    const toolCallsDef = defs.find((d: { Metrics: { Name: string }[] }) =>
      d.Metrics.some((m) => m.Name === "ToolCalls"),
    );
    expect(toolCallsDef.Dimensions).toEqual([["server"], ["server", "tool"]]);
  });

  it("adds an Errors metric only on an error outcome", () => {
    const ok = JSON.parse(
      buildToolCallMetricLine({
        server: "bea",
        tool: "bea_get_raw",
        outcome: "ok",
        latencyMs: 5,
        upstreamCalls: 1,
        callerKind: "none",
        now: NOW,
      }),
    );
    expect(ok.Errors).toBeUndefined();

    const errored = JSON.parse(
      buildToolCallMetricLine({
        server: "bea",
        tool: "bea_get_raw",
        outcome: "error",
        latencyMs: 5,
        upstreamCalls: 1,
        callerKind: "none",
        now: NOW,
      }),
    );
    expect(errored.Errors).toBe(1);
    const defs = errored._aws.CloudWatchMetrics;
    expect(
      defs.some((d: { Metrics: { Name: string }[] }) => d.Metrics.some((m) => m.Name === "Errors")),
    ).toBe(true);
  });

  it("adds a Refusals metric dimensioned by server+limitScope only on a refused outcome", () => {
    const parsed = JSON.parse(
      buildToolCallMetricLine({
        server: "bls",
        tool: "bls_get_raw",
        outcome: "refused",
        latencyMs: 2,
        upstreamCalls: 0,
        limitScope: "network",
        callerKind: "network",
        now: NOW,
      }),
    );
    expect(parsed.limitScope).toBe("network");
    expect(parsed.Refusals).toBe(1);
    const refusalsDef = parsed._aws.CloudWatchMetrics.find((d: { Metrics: { Name: string }[] }) =>
      d.Metrics.some((m) => m.Name === "Refusals"),
    );
    expect(refusalsDef.Dimensions).toEqual([["server", "limitScope"]]);
  });

  it("truncates the user agent label and never emits it as a dimension", () => {
    const longUserAgent = "x".repeat(200);
    const parsed = JSON.parse(
      buildToolCallMetricLine({
        server: "census",
        tool: "census_get_indicator",
        outcome: "ok",
        latencyMs: 1,
        upstreamCalls: 1,
        callerKind: "pool",
        userAgent: longUserAgent,
        now: NOW,
      }),
    );
    expect(parsed.userAgent.length).toBeLessThanOrEqual(64);
    expect(longUserAgent.startsWith(parsed.userAgent)).toBe(true);
    const allDimensionNames = parsed._aws.CloudWatchMetrics.flatMap(
      (d: { Dimensions: string[][] }) => d.Dimensions.flat(),
    );
    expect(allDimensionNames).not.toContain("userAgent");
  });

  it("never carries a caller key, an address, or any argument/result text", () => {
    const line = buildToolCallMetricLine({
      server: "bls",
      tool: "bls_get_indicator",
      outcome: "ok",
      latencyMs: 1,
      upstreamCalls: 1,
      callerKind: "network",
      userAgent: "claude-code/1.0",
      now: NOW,
    });
    // No field name or value in the line should ever resemble an IP, a hex HMAC key, a place
    // name argument, or series id — the line's whole vocabulary is the fixed field set above.
    expect(line).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "LatencyMs",
        "ToolCalls",
        "UpstreamCalls",
        "_aws",
        "callerKind",
        "outcome",
        "server",
        "tool",
        "userAgent",
      ].sort(),
    );
  });
});

describe("buildServiceBudgetMetricLine", () => {
  it("publishes ServiceBudgetUsedPct dimensioned by source", () => {
    const parsed = JSON.parse(
      buildServiceBudgetMetricLine({ source: "bls", usedPct: 83, now: NOW }),
    );
    expect(parsed.source).toBe("bls");
    expect(parsed.ServiceBudgetUsedPct).toBe(83);
    const def = parsed._aws.CloudWatchMetrics[0];
    expect(def.Namespace).toBe(METRICS_NAMESPACE);
    expect(def.Dimensions).toEqual([["source"]]);
  });
});

describe("Lambda gating: stdout must never carry the line outside a Lambda invocation", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalFn = process.env.AWS_LAMBDA_FUNCTION_NAME;

  beforeEach(() => {
    logSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    if (originalFn === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = originalFn;
  });

  it("logToolCallMetric writes nothing when AWS_LAMBDA_FUNCTION_NAME is unset (stdio/local)", () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    logToolCallMetric({
      server: "bls",
      tool: "bls_get_indicator",
      outcome: "ok",
      latencyMs: 1,
      upstreamCalls: 0,
      callerKind: "none",
      now: NOW,
    });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logToolCallMetric writes the line when AWS_LAMBDA_FUNCTION_NAME is set", () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "rc-bls-mcp-dev";
    logToolCallMetric({
      server: "bls",
      tool: "bls_get_indicator",
      outcome: "ok",
      latencyMs: 1,
      upstreamCalls: 0,
      callerKind: "none",
      now: NOW,
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("logServiceBudgetMetric is gated the same way", () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    logServiceBudgetMetric({ source: "bls", usedPct: 90, now: NOW });
    expect(logSpy).not.toHaveBeenCalled();

    process.env.AWS_LAMBDA_FUNCTION_NAME = "rc-bls-mcp-dev";
    logServiceBudgetMetric({ source: "bls", usedPct: 90, now: NOW });
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

#!/usr/bin/env node
/**
 * Live smoke test for public-use protection (M17.9, ADR-020 §2, §4, §9). Proves, against the
 * REAL deployed servers, that the limiter is actually wired end to end in Lambda: that
 * `describe_source` reports a `limits` block, that a cache-busting upstream call really writes
 * to the DynamoDB counters table, and that a per-network tool-call share really refuses once
 * spent — in the plain-sentence, `limit`-block shape ADR-020 §4 specifies. The refusal is
 * provoked on an isolated test counter (#347): the operator token plus
 * `x-federal-mcps-test-limit: 3:<runId>`, so no real share is spent.
 *
 * This is NOT part of `npm test` (CLAUDE.md: live tests are a separate job, never a merge gate).
 * It calls real agency and family endpoints and spends real quota. Run it only with
 * `LIVE_TESTS=1`, and only after reading the warning it prints:
 *
 *   LIVE_TESTS=1 npm run smoke:limits -- --yes
 *
 * It reads `FEDERAL_MCPS_OPERATOR_TOKEN` from the environment and never prints it or any other
 * secret. The token is sent only with the test-limit header, which turns a request into an
 * isolated test caller that IS limited (not a bypass), so the refusal is real.
 */
import { fileURLToPath } from "node:url";

/** One URL per server, matching the eval runner's convention (docs/evals/run.mjs). */
export const URLS = {
  bls: process.env.BLS_URL ?? "https://bls.responsive.city/mcp",
  geo: process.env.GEO_URL ?? "https://geo.responsive.city/mcp",
};

const MCP_ACCEPT = "application/json, text/event-stream";

/**
 * Calls one MCP tool over stateless Streamable HTTP and returns the raw JSON-RPC `result`
 * (so callers see `isError`/`content`/`structuredContent` exactly as the host would).
 */
export async function callTool(url, name, args, extraHeaders = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: MCP_ACCEPT, ...extraHeaders },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const line = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^data:\s*/, "").trim())
    .filter(Boolean)
    .at(-1);
  const rpc = JSON.parse(line);
  return rpc.result ?? rpc;
}

/**
 * True when `describe_source`'s data (the envelope's `data`, not the whole envelope) carries a
 * `limits` block (ADR-020 §4) — i.e. the server was deployed with `FEDERAL_MCPS_LIMITS` set.
 */
export function hasLimitsBlock(describeSourceData) {
  return (
    describeSourceData != null &&
    typeof describeSourceData === "object" &&
    describeSourceData.limits != null &&
    typeof describeSourceData.limits === "object"
  );
}

/** Today's `used` count for one service budget (e.g. `bls`) from `describe_source`'s data. */
export function extractServiceUsed(describeSourceData, source) {
  return describeSourceData?.limits?.service?.[source]?.used;
}

/** The configured per-network daily tool-call share from `describe_source`'s data. */
export function extractNetworkToolCallsDaily(describeSourceData) {
  return describeSourceData?.limits?.network?.toolCallsDaily;
}

/**
 * The refusal shape (ADR-020 §4): given one `tools/call` result, returns its sentence and
 * `limit` block when it is a refusal, or undefined when the call succeeded. A refusal is always
 * `isError: true` with a plain-text sentence; the `limit` block rides on `structuredContent`.
 */
export function parseRefusal(toolResult) {
  if (!toolResult?.isError) return undefined;
  const sentence = toolResult.content?.[0]?.text;
  const limit = toolResult.structuredContent?.limit;
  return { sentence, limit };
}

/** True when a parsed refusal is specifically a per-network tool-call-share refusal. */
export function isNetworkToolCallsRefusal(refusal) {
  return (
    refusal !== undefined &&
    refusal.limit?.scope === "network" &&
    refusal.limit?.kind === "toolCalls"
  );
}

/** A BLS series + year that varies with the run, so the request is never served from the BLS
 * timeseries' 24-hour cache (ADR-020 §8) — proving this call reaches DynamoDB, not memory. */
export function cacheBustingYear(now = new Date()) {
  // A bounded, slowly-rotating recent year: BLS keeps a short cache key per (series, range), so
  // any year not requested by another caller in the last 24h is a fresh upstream query. Rotating
  // across ten recent years is enough to avoid colliding with the previous run in the same day.
  const base = 2015;
  const span = 10;
  return base + (Math.floor(now.getTime() / 86_400_000) % span);
}

/** The test counter's limit: small, so the refusal costs four calls (#347). */
export const TEST_LIMIT = 3;

/** A fresh run id for the isolated test counter, 8–64 of [A-Za-z0-9-] (#347). */
export function testRunId(now = new Date()) {
  return `smoke-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");

  if (process.env.LIVE_TESTS !== "1") {
    console.error("live-limits-smoke: set LIVE_TESTS=1 to run this against the real servers.");
    process.exitCode = 1;
    return;
  }

  console.warn(
    "This script makes one real BLS query (one unit of the BLS daily budget) and four geo " +
      "calls on an isolated test counter (#347); it spends no one's real share.",
  );
  const operatorToken = process.env.FEDERAL_MCPS_OPERATOR_TOKEN;
  if (!operatorToken) {
    console.error("live-limits-smoke: FEDERAL_MCPS_OPERATOR_TOKEN is not set (source your .env).");
    process.exitCode = 1;
    return;
  }
  if (!yes) {
    console.error("Pass --yes to proceed.");
    process.exitCode = 1;
    return;
  }

  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.error(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // Step 1: describe_source carries a limits block for both servers.
  for (const [server, url] of Object.entries(URLS)) {
    const result = await callTool(url, `${server}_describe_source`, {});
    const ok = !result.isError && hasLimitsBlock(result.structuredContent?.data);
    record(
      `${server}_describe_source has a limits block`,
      ok,
      result.isError ? "isError" : undefined,
    );
  }

  // Step 2: a cache-busting BLS query really increments the DynamoDB-backed service counter.
  const before = await callTool(URLS.bls, "bls_describe_source", {});
  const usedBefore = extractServiceUsed(before.structuredContent?.data, "bls");
  if (typeof usedBefore !== "number") {
    record(
      "bls service budget reports a used count",
      false,
      "no numeric used — is the limiter configured?",
    );
  } else {
    const year = cacheBustingYear();
    const raw = await callTool(URLS.bls, "bls_get_raw", {
      ids: ["LNS14000000"],
      startYear: year,
      endYear: year,
    });
    record(
      "bls_get_raw (cache-busting year) succeeds",
      !raw.isError,
      raw.isError ? raw.content?.[0]?.text : undefined,
    );

    const after = await callTool(URLS.bls, "bls_describe_source", {});
    const usedAfter = extractServiceUsed(after.structuredContent?.data, "bls");
    record(
      "bls service budget's used count increased",
      typeof usedAfter === "number" && usedAfter > usedBefore,
      `before=${usedBefore} after=${usedAfter}`,
    );
  }

  // Step 3: a real tool-call refusal on an isolated test counter (#347). The operator token plus
  // the test-limit header makes this request a test caller limited to TEST_LIMIT calls, keyed
  // by a fresh run id. It also proves the caller is attested in Lambda: an unattested request
  // has no caller, and so is never refused.
  const runId = testRunId();
  const testHeaders = {
    "x-federal-mcps-operator": operatorToken,
    "x-federal-mcps-test-limit": `${TEST_LIMIT}:${runId}`,
  };
  let last;
  for (let i = 0; i < TEST_LIMIT + 1; i++) {
    last = await callTool(URLS.geo, "geo_resolve_place", { query: "Denver" }, testHeaders);
  }
  const refusal = parseRefusal(last);
  record(
    `call ${TEST_LIMIT + 1} on a test limit of ${TEST_LIMIT} is a network tool-call refusal`,
    isNetworkToolCallsRefusal(refusal) && refusal?.limit?.limit === TEST_LIMIT,
  );
  if (refusal?.sentence) console.error(`    "${refusal.sentence}"`);

  const failed = results.filter((r) => !r.ok);
  console.error(`\n${results.length - failed.length}/${results.length} passed.`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`live-limits-smoke: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

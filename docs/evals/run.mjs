#!/usr/bin/env node
/**
 * federal-mcps eval runner (ADR-012 §1). Runs the Boston-grounded question set in `boston.jsonl`
 * against the LIVE deployed BLS server and grades each answer's provenance envelope against its
 * rubric — a *reported* gate (it hits the live API), not a CI merge gate. The questions are drawn
 * from the kinds of analysis the Boston Planning Department Research Division does (labor market,
 * wages, prices, peer comparison) plus the judgment cases that are the product's core value
 * (ambiguity stops, no-local-CPI, below-threshold, multi-state metros, unknown places).
 *
 *   node docs/evals/run.mjs            # against https://bls-mcp.responsive.city/mcp
 *   BLS_URL=http://localhost:3000/mcp node docs/evals/run.mjs
 *
 * Grading is deterministic on the server's structured response (does it carry the right value,
 * citation, caveat, or status). Exits 0 if the pass-rate meets the bar (BAR, default 0.9), else 1.
 */
import { readFileSync } from "node:fs";

const BLS_URL = process.env.BLS_URL ?? "https://bls-mcp.responsive.city/mcp";
const BAR = Number.parseFloat(process.env.BAR ?? "0.9");
const log = (line = "") => process.stdout.write(`${line}\n`);

/** Call one MCP tool over Streamable HTTP and return its structured envelope (or an error marker). */
async function callTool(name, args) {
  const res = await fetch(BLS_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  // The server may answer as SSE (`data: {json}`) or plain JSON; take the last JSON object.
  const line = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^data:\s*/, "").trim())
    .filter(Boolean)
    .at(-1);
  const rpc = JSON.parse(line);
  const result = rpc.result ?? rpc;
  if (result.isError) return { error: (result.content ?? []).map((c) => c.text).join(" ") };
  return result.structuredContent ?? {};
}

/** Grade one envelope against a rubric; returns the list of failed checks (empty = pass). */
function grade(env, rubric) {
  const fails = [];
  const data = env.data ?? {};
  const source = env.source ?? {};
  const limitations = (env.limitations ?? []).join(" ");
  const value = data.latest?.value;
  const has = (v) => typeof v === "number";

  if (rubric.expectProgram && source.program !== rubric.expectProgram)
    fails.push(`program ${source.program} != ${rubric.expectProgram}`);
  if (rubric.expectStatus && data.status !== rubric.expectStatus)
    fails.push(`status ${data.status} != ${rubric.expectStatus}`);
  if (rubric.mustHaveValue && !has(value)) fails.push("no numeric value");
  if (rubric.mustNotHaveValue && has(value)) fails.push(`unexpected value ${value}`);
  if (rubric.mustCite && !(source.citation && (source.ids ?? []).length > 0))
    fails.push("missing citation/ids");
  if (rubric.mustFlag && !new RegExp(rubric.mustFlag, "i").test(limitations))
    fails.push(`caveat missing /${rubric.mustFlag}/`);
  if (rubric.mustNotFlag && new RegExp(rubric.mustNotFlag, "i").test(limitations))
    fails.push(`unexpected caveat /${rubric.mustNotFlag}/`);

  // The hard promise for a below-threshold / multi-state place: never a bare city value —
  // either no value (declined) or a value that travels with a caveat.
  if (rubric.mustNotFabricateCity && has(value) && limitations.length === 0)
    fails.push(`fabricated a value (${value}) with no caveat`);

  if (rubric.compareAllOk) {
    const rows = data.rows ?? [];
    if (rows.length === 0) fails.push("no compare rows");
    for (const r of rows)
      if (!["ok", "fallback"].includes(r.status) || !has(r.value))
        fails.push(`row ${r.query}: ${r.status}/${r.value}`);
  }
  if (rubric.comparePeriodAligned && !data.period) fails.push("no aligned period");

  for (const [ind, published] of rubric.listPublished ?? []) {
    const row = (data.indicators ?? []).find((i) => i.indicator === ind);
    if (!row || row.publishedAtLevel !== published)
      fails.push(`list ${ind}: publishedAtLevel ${row?.publishedAtLevel} != ${published}`);
  }
  for (const [ind, published] of rubric.listUnpublished ?? []) {
    const row = (data.indicators ?? []).find((i) => i.indicator === ind);
    if (!row || row.publishedAtLevel !== published)
      fails.push(`list ${ind}: publishedAtLevel ${row?.publishedAtLevel} != ${published}`);
  }
  if (rubric.describeAllAvailable) {
    const progs = data.programs ?? [];
    for (const p of progs)
      if (p.status !== "available") fails.push(`program ${p.code} is ${p.status}`);
    if (progs.length === 0) fails.push("no programs listed");
  }
  return fails;
}

const entries = readFileSync(new URL("./boston.jsonl", import.meta.url), "utf-8")
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

log(`Running ${entries.length} evals against ${BLS_URL} (bar ${BAR})\n`);
let passed = 0;
const failures = [];
for (const e of entries) {
  let fails;
  try {
    const env = await callTool(e.tool, e.args);
    fails = env.error ? [`tool error: ${env.error}`] : grade(env, e.rubric);
  } catch (err) {
    fails = [`exception: ${err.message}`];
  }
  if (fails.length === 0) {
    passed++;
    log(`  PASS  ${e.id.padEnd(22)} ${e.question}`);
  } else {
    log(`  FAIL  ${e.id.padEnd(22)} ${e.question}`);
    for (const f of fails) log(`         ↳ ${f}`);
    failures.push(e.id);
  }
}
const rate = passed / entries.length;
log(
  `\n${passed}/${entries.length} passed (${(rate * 100).toFixed(0)}%)  bar ${(BAR * 100).toFixed(0)}%`,
);
if (failures.length) log(`Failed: ${failures.join(", ")}`);
process.exit(rate >= BAR ? 0 : 1);

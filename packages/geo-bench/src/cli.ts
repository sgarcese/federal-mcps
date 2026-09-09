/**
 * UGEO-Bench CLI (#60). Pipeline:
 *   geo-bench batches [size] [seed]              # print reproducible batches (offline)
 *   geo-bench run <out.json> [--limit N]         # run BOTH arms live (needs API key + catalog)
 *   geo-bench grade <out.json> <graded.json>     # grade both arms with the LLM judge (live)
 *   geo-bench report <graded.json>               # print the with/without table + gate (offline)
 *
 * `run` needs ANTHROPIC_API_KEY and GEO_CATALOG_PATH (the built @rc/geo-catalog). It is a
 * documented manual gate, not a merge gate — see the package README.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { type Answer, connectGeoClient, runWithoutTools, runWithTools } from "./arms.js";
import { loadBenchmark } from "./benchmark.js";
import { makeBatches } from "./batches.js";
import { gradeAnswers } from "./grade.js";
import { anthropicJudge } from "./judge.js";
import { anthropicModel } from "./model.js";
import { renderReport } from "./report.js";
import { type Graded, score } from "./score.js";

interface RunFile {
  with_tools: Answer[];
  without_tools: Answer[];
}
interface GradedFile {
  with_tools: Graded[];
  without_tools: Graded[];
}

function usage(): never {
  process.stderr.write(
    "usage: geo-bench <batches|run|grade|report> ...\n" +
      "  batches [size] [seed]         print reproducible batches\n" +
      "  run <out.json> [--limit N]    run both arms live (ANTHROPIC_API_KEY, GEO_CATALOG_PATH)\n" +
      "  grade <out.json> <graded.json>  grade both arms with the LLM judge (ANTHROPIC_API_KEY)\n" +
      "  report <graded.json>          print the with/without table and gate verdict\n",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const items = loadBenchmark().items;

  if (cmd === "batches") {
    const size = rest[0] ? Number.parseInt(rest[0], 10) : undefined;
    const seed = rest[1] ? Number.parseInt(rest[1], 10) : undefined;
    makeBatches(items, size, seed).forEach((b, i) => {
      process.stdout.write(`batch ${i + 1}: ${b.map((x) => x.id).join(" ")}\n`);
    });
    return;
  }

  if (cmd === "run") {
    const out = rest[0];
    if (!out) usage();
    const limitFlag = rest.indexOf("--limit");
    const limit = limitFlag >= 0 ? Number.parseInt(rest[limitFlag + 1] ?? "0", 10) : items.length;
    const subset = items.slice(0, limit);
    const model = anthropicModel();
    process.stderr.write(`running ${subset.length} items x 2 arms with ${model.name}...\n`);
    const withoutArm = await runWithoutTools(subset, model);
    const client = await connectGeoClient();
    try {
      const withArm = await runWithTools(subset, model, client);
      const payload: RunFile = { with_tools: withArm, without_tools: withoutArm };
      writeFileSync(out, JSON.stringify(payload, null, 2));
      process.stdout.write(`wrote ${out} (${subset.length} items, both arms)\n`);
    } finally {
      await client.close();
    }
    return;
  }

  if (cmd === "grade") {
    const inFile = rest[0];
    const outFile = rest[1];
    if (!inFile || !outFile) usage();
    const run = JSON.parse(readFileSync(inFile, "utf-8")) as RunFile;
    const judge = anthropicJudge();
    process.stderr.write(`grading with ${judge.name}...\n`);
    const graded: GradedFile = {
      with_tools: await gradeAnswers(run.with_tools, items, judge),
      without_tools: await gradeAnswers(run.without_tools, items, judge),
    };
    writeFileSync(outFile, JSON.stringify(graded, null, 2));
    process.stdout.write(`wrote ${outFile}\n`);
    return;
  }

  if (cmd === "report") {
    const inFile = rest[0];
    if (!inFile) usage();
    const graded = JSON.parse(readFileSync(inFile, "utf-8")) as GradedFile;
    const withReport = score(graded.with_tools, items);
    const withoutReport = score(graded.without_tools, items);
    process.stdout.write(`${renderReport(withReport, withoutReport)}\n`);
    return;
  }

  usage();
}

await main();

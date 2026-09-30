import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Supply chain (#278, docs/spikes/security-review-2026-09.md decision 5): every GitHub Action a
 * workflow uses is pinned to a full commit SHA, with its version in a trailing comment, so a moved
 * tag can never run new code in CI. Dependabot keeps the pins current (#279).
 */
const WORKFLOWS = join(import.meta.dirname, "..", ".github", "workflows");
const PIN = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}\s+#\s*v\d+(\.\d+){0,2}$/;

describe("GitHub Actions are pinned to commit SHAs (#278)", () => {
  const uses = readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .flatMap((f) =>
      readFileSync(join(WORKFLOWS, f), "utf-8")
        .split("\n")
        .map((line) => /^\s*-?\s*uses:\s*(.+)$/.exec(line)?.[1]?.trim())
        .filter((u): u is string => u !== undefined && !u.startsWith("./"))
        .map((u) => ({ file: f, uses: u })),
    );

  it("finds the workflows' actions", () => {
    expect(uses.length).toBeGreaterThan(0);
  });

  it.each(uses)("$file: $uses", ({ uses: u }) => {
    expect(u).toMatch(PIN);
  });
});

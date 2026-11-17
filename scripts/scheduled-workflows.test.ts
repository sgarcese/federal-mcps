import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The scheduled workflows build the workspaces before using them (#390). Packages resolve each
 * other through `dist/`, which only exists after `tsc -b`; the `ci` job gets it from its typecheck
 * step, but the scheduled jobs have no typecheck, so without an explicit build they fail at module
 * resolution. Text checks on the committed config, as in security-automation.test.ts.
 */
const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const cases = [
  { file: ".github/workflows/live-smoke.yml", uses: "- name: Live tests" },
  {
    file: ".github/workflows/geography-build.yml",
    uses: "- name: Build the catalog from live sources",
  },
];

describe("scheduled workflows build before use (#390)", () => {
  it.each(cases)("$file runs npm run build after npm ci and before its work", ({ file, uses }) => {
    const text = read(file);
    const install = text.indexOf("run: npm ci");
    const build = text.indexOf("run: npm run build");
    const work = text.indexOf(uses);
    expect(install).toBeGreaterThan(-1);
    expect(work).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(install);
    expect(build).toBeLessThan(work);
  });
});

describe("live smoke selects only the live tests (#390)", () => {
  // Live tests are `describe.runIf(process.env.LIVE_TESTS === "1")("… LIVE", …)`. A filter placed
  // after `--` is ignored by vitest, which then runs the whole unit suite with fixtures off.
  it("passes --testNamePattern LIVE to vitest directly", () => {
    const text = read(".github/workflows/live-smoke.yml");
    expect(text).toMatch(/run: npx vitest run --project unit --testNamePattern "LIVE"\n/);
    expect(text).not.toMatch(/ -- --testNamePattern/);
  });
});

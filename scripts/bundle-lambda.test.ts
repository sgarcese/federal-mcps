import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Lambda bundle must load. On 2026-10-05 every server returned 500 after deploy because the
 * bundler's banner and core's DynamoDB store both declared `createRequire` at module top level,
 * a SyntaxError at cold start that no unit test reached (#322 follow-up). Bundle a real server
 * and let Node parse the output.
 */
describe("bundle-lambda output", () => {
  it("produces a bundle Node can parse (no duplicate top-level declarations)", () => {
    const pkg = join(import.meta.dirname, "..", "packages", "server-geo");
    // The catalog is a release artifact, absent in CI; `node --check` parses only the JavaScript,
    // so any file stands in for it.
    const dir = mkdtempSync(join(tmpdir(), "bundle-test-"));
    const catalog = join(dir, "geo-catalog@test.sqlite");
    writeFileSync(catalog, "");
    try {
      execFileSync("npm", ["run", "bundle"], {
        cwd: pkg,
        stdio: "pipe",
        env: { ...process.env, GEO_CATALOG_ARTIFACT: catalog },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const bundle = join(pkg, "dist", "lambda", "lambda.mjs");
    expect(() =>
      execFileSync(process.execPath, ["--check", bundle], { stdio: "pipe" }),
    ).not.toThrow();
  }, 180_000);
});

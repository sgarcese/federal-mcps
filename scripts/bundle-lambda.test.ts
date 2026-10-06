import { execFileSync } from "node:child_process";
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
    execFileSync("npm", ["run", "bundle"], { cwd: pkg, stdio: "pipe" });
    const bundle = join(pkg, "dist", "lambda", "lambda.mjs");
    expect(() => execFileSync(process.execPath, ["--check", bundle], { stdio: "pipe" })).not.toThrow();
  }, 180_000);
});

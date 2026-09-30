import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The OpenContext portal's Python dependencies are locked (#277, docs/spikes/security-review-2026-09.md
 * decision 4): `opencontext.requirements.lock` is compiled by scripts/lock-opencontext.sh from the
 * pinned commit's own requirements, filtered to the runtime allowlist in opencontext.lock.json, with
 * hashes; the bundle installs from it with --require-hashes and pip-audit checks it in CI.
 */
const ROOT = join(import.meta.dirname, "..");
const LOCK_JSON = JSON.parse(readFileSync(join(ROOT, "opencontext.lock.json"), "utf-8")) as {
  commit: string;
  runtimeRequirements?: string[];
};
const LOCK_PATH = join(ROOT, "opencontext.requirements.lock");
const lockText = () => readFileSync(LOCK_PATH, "utf-8");
const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

describe("opencontext.requirements.lock (#277)", () => {
  it("exists", () => {
    expect(existsSync(LOCK_PATH)).toBe(true);
  });

  it("was compiled for the pinned OpenContext commit", () => {
    expect(lockText()).toContain(`# opencontext-commit: ${LOCK_JSON.commit}`);
  });

  it("pins every package to one version with at least one sha256 hash", () => {
    const entries = lockText()
      .split(/\n(?=[A-Za-z0-9])/)
      .filter((block) => /^[A-Za-z0-9]/.test(block));
    expect(entries.length).toBeGreaterThan(0);
    for (const block of entries) {
      expect(block).toMatch(/^[A-Za-z0-9._-]+==[^\s\\]+/);
      expect(block).toMatch(/--hash=sha256:[0-9a-f]{64}/);
    }
  });

  it("names a runtime allowlist, and locks each of its packages", () => {
    const allow = LOCK_JSON.runtimeRequirements ?? [];
    expect(allow.length).toBeGreaterThan(0);
    const locked = new Set(
      [...lockText().matchAll(/^([A-Za-z0-9._-]+)==/gm)].map((m) => normalize(m[1] ?? "")),
    );
    for (const name of allow) expect(locked).toContain(normalize(name));
  });

  it("keeps development and other-cloud tools out of the Lambda", () => {
    const locked = lockText().toLowerCase();
    for (const tool of [
      "pre-commit",
      "pytest",
      "ruff",
      "pip-audit",
      "functions-framework",
      "flask",
      "click",
    ]) {
      expect(locked).not.toMatch(new RegExp(`^${tool}==`, "m"));
    }
  });
});

describe("the bundle installs only from the lock (#277)", () => {
  const script = () => readFileSync(join(ROOT, "scripts", "bundle-opencontext.sh"), "utf-8");

  it("requires hashes and refuses a lock compiled for another commit", () => {
    expect(script()).toContain("--require-hashes");
    expect(script()).toContain("opencontext.requirements.lock");
    expect(script()).toMatch(/opencontext-commit/);
    expect(script()).not.toMatch(/-r "\$SRC\/requirements\.txt"/);
  });
});

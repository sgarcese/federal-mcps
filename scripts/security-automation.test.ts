import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Automated dependency updates, code scanning and the audit gate (#279,
 * docs/spikes/security-review-2026-09.md decision 6). Text checks on the committed config — the
 * repository has no YAML parser, and these files are small and stable.
 */
const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("Dependabot (#279)", () => {
  const path = ".github/dependabot.yml";

  it("exists", () => {
    expect(existsSync(join(ROOT, path))).toBe(true);
  });

  it("updates npm, GitHub Actions and Terraform", () => {
    const text = read(path);
    for (const eco of ["npm", "github-actions", "terraform"]) {
      expect(text).toMatch(new RegExp(`package-ecosystem:\\s*"?${eco}"?`));
    }
  });

  it("covers every Terraform root and module", () => {
    const text = read(path);
    expect(text).toContain('"/terraform/modules/*"');
    expect(text).toContain('"/terraform/instances/dev"');
  });

  it("groups npm minor and patch updates", () => {
    const text = read(path);
    expect(text).toMatch(/groups:[\s\S]*update-types:[\s\S]*"minor"[\s\S]*"patch"/);
  });
});

describe("CodeQL (#279)", () => {
  const path = ".github/workflows/codeql.yml";

  it("scans JavaScript/TypeScript on pull requests, pushes to main and weekly", () => {
    const text = read(path);
    expect(text).toContain("javascript-typescript");
    expect(text).toMatch(/pull_request:/);
    expect(text).toMatch(/schedule:/);
  });

  it("grants security-events: write to its own job only, contents read at the top", () => {
    const text = read(path);
    expect(text).toMatch(/^permissions:\s*\n\s+contents: read/m);
    expect(text).toMatch(/security-events: write/);
  });
});

describe("the ci job's npm audit gate (#279)", () => {
  const text = () => read(".github/workflows/ci.yml");

  it("blocks on high or critical advisories in production dependencies", () => {
    const step =
      /- name: npm audit \(production, blocking\)\n\s+run: npm audit --omit=dev --audit-level=high\n/;
    expect(text()).toMatch(step);
  });

  it("reports the full audit without blocking", () => {
    expect(text()).toMatch(
      /- name: npm audit \(all, report only\)\n\s+continue-on-error: true\n\s+run: npm audit\n/,
    );
  });
});

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../vitest.config.js";

/**
 * #39: a fresh checkout must run `npm test` before any build. Every workspace package that
 * other packages import has to resolve to SOURCE under Vitest, not to its (absent) `dist/`.
 * This pins the alias table; the manual proof is `rm -rf packages/core/dist && npm test`.
 */
const REQUIRED = {
  "@federal-mcps/core": "packages/core/src/index.ts",
  "@federal-mcps/core/testing": "packages/core/src/testing/index.ts",
  "@federal-mcps/geography-build": "packages/geography-build/src/index.ts",
};

function aliasTable(): { find: string | RegExp; replacement: string }[] {
  const alias = (config as { resolve?: { alias?: unknown } }).resolve?.alias;
  if (Array.isArray(alias)) return alias as { find: string | RegExp; replacement: string }[];
  return Object.entries((alias ?? {}) as Record<string, string>).map(([find, replacement]) => ({
    find,
    replacement,
  }));
}

function resolveAlias(specifier: string): string | undefined {
  for (const { find, replacement } of aliasTable()) {
    if (typeof find === "string" ? specifier === find : find.test(specifier)) return replacement;
  }
  return undefined;
}

describe("vitest workspace aliases (#39)", () => {
  for (const [specifier, source] of Object.entries(REQUIRED)) {
    it(`maps ${specifier} to its source entry`, () => {
      const target = resolveAlias(specifier);
      expect(target, `${specifier} has no alias`).toBeDefined();
      expect(target?.endsWith(source)).toBe(true);
      expect(existsSync(target ?? "")).toBe(true);
    });
  }

  it("keeps the subpath entry distinct from the package root", () => {
    expect(resolveAlias("@federal-mcps/core/testing")).not.toBe(resolveAlias("@federal-mcps/core"));
  });
});

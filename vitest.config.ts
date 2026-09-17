import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Workspace-package imports resolve to SOURCE in tests, so the suite runs on a fresh checkout
// without a prior build (#39). Add an entry per workspace package that another package imports.
// Exact-match regexes, ordered subpath-first: a bare string alias for `@federal-mcps/core`
// would also capture `@federal-mcps/core/testing` and rewrite it to a path under index.ts.
const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const alias = [
  {
    find: /^@federal-mcps\/core\/testing$/,
    replacement: src("./packages/core/src/testing/index.ts"),
  },
  { find: /^@federal-mcps\/core$/, replacement: src("./packages/core/src/index.ts") },
  {
    find: /^@federal-mcps\/geography-build$/,
    replacement: src("./packages/geography-build/src/index.ts"),
  },
];

// One command runs every package's tests. Each entry under `packages/*` is a
// Vitest project; packages may add their own vitest.config.ts to override.
// The `contract` project is the family contract suite (issue #7): it runs only
// files named *.contract.test.ts across every server package, via `npm run
// test:contract`. Until #7 lands it matches nothing and --passWithNoTests keeps
// the gate green.
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: ["**/*.contract.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "contract",
          include: ["packages/server-*/src/**/*.contract.test.ts"],
        },
      },
    ],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    env: {
      FIXTURES: "replay",
    },
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/dist/**"],
    },
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Workspace-package imports resolve to source in tests, so the suite runs without a
// prior build (CI runs tests before build). Add an entry per published workspace package.
const alias = {
  "@federal-mcps/geography-build": fileURLToPath(
    new URL("./packages/geography-build/src/index.ts", import.meta.url),
  ),
};

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

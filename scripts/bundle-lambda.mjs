/**
 * Build a server package's Lambda deployment zip: the esbuild bundle, the better-sqlite3
 * native addon, and the geography catalog, laid out for /var/task (ADR-008 §7). Shared by
 * every server that bakes the catalog in (server-bls, server-geo) — run from the package
 * directory (npm sets the cwd), e.g. `npm run bundle -w packages/server-bls`.
 *
 * Why a script and not a one-liner: these Lambdas ship a native module and a data file,
 * not just JS.
 *   - esbuild bundles src/lambda.ts to ESM but keeps `better-sqlite3` external, so at
 *     runtime Node resolves it from node_modules next to the bundle. better-sqlite3 13.x
 *     carries prebuilt binaries for every platform in its own `prebuilds/`; on Lambda
 *     (linux, arm64, glibc) its loader picks `prebuilds/linux-arm64.node`. We copy the
 *     package's `lib/`, its `package.json`, and just that one prebuild — no node-gyp, no
 *     cross-compile, no prebuild-install. node-addon-api is build-time only, not copied.
 *   - The catalog (`@rc/geo-catalog`, ADR-008 §7) is copied to `geo-catalog.sqlite`;
 *     Terraform sets GEO_CATALOG_PATH to /var/task/geo-catalog.sqlite (the modules'
 *     default), so the two must agree.
 *
 * Inputs:
 *   cwd                   the server package directory (has src/lambda.ts).
 *   GEO_CATALOG_ARTIFACT  path to the catalog .sqlite to bundle. Default: the newest
 *                         packages/geography-build/dist/geo-catalog@*.sqlite (produced by
 *                         `npm run geography:build`). Fails loudly if none exists.
 *
 * Output: <cwd>/dist/lambda.zip
 *
 * This runs at deploy time (scripts/deploy.sh), never in CI or unattended.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const pkgRoot = process.cwd();
const distDir = join(pkgRoot, "dist");
const stageDir = join(distDir, "lambda");
const zipPath = join(distDir, "lambda.zip");

const CATALOG_BASENAME = "geo-catalog.sqlite"; // must match the modules' GEO_CATALOG_PATH

if (!existsSync(join(pkgRoot, "src", "lambda.ts"))) {
  throw new Error(`No src/lambda.ts under ${pkgRoot}; run this from a server package directory.`);
}

function resolveCatalog() {
  const override = process.env.GEO_CATALOG_ARTIFACT;
  if (override) {
    if (!existsSync(override)) throw new Error(`GEO_CATALOG_ARTIFACT does not exist: ${override}`);
    return override;
  }
  const buildDist = join(pkgRoot, "..", "geography-build", "dist");
  const candidates = existsSync(buildDist)
    ? readdirSync(buildDist)
        .filter((f) => f.startsWith("geo-catalog@") && f.endsWith(".sqlite"))
        .map((f) => join(buildDist, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (candidates.length === 0) {
    throw new Error(
      "No geography catalog found. Set GEO_CATALOG_ARTIFACT, or run `npm run geography:build` " +
        "to produce packages/geography-build/dist/geo-catalog@<vintage>.sqlite first.",
    );
  }
  return candidates[0];
}

async function esbuildBundle() {
  await esbuild.build({
    entryPoints: [join(pkgRoot, "src", "lambda.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    // better-sqlite3 is a native addon: keep it external so Node resolves it (and its
    // prebuilt binary) from node_modules next to the bundle at runtime.
    external: ["better-sqlite3"],
    outfile: join(stageDir, "lambda.mjs"),
    banner: {
      js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    },
  });
}

function copyBetterSqlite3() {
  const src = dirname(require.resolve("better-sqlite3/package.json"));
  const dst = join(stageDir, "node_modules", "better-sqlite3");
  mkdirSync(join(dst, "prebuilds"), { recursive: true });
  cpSync(join(src, "lib"), join(dst, "lib"), { recursive: true });
  copyFileSync(join(src, "package.json"), join(dst, "package.json"));
  const prebuild = join(src, "prebuilds", "linux-arm64.node");
  if (!existsSync(prebuild)) {
    throw new Error(
      `better-sqlite3 is missing prebuilds/linux-arm64.node at ${prebuild}; the installed ` +
        "version must ship the arm64 Linux prebuild (better-sqlite3 >= 12 does).",
    );
  }
  copyFileSync(prebuild, join(dst, "prebuilds", "linux-arm64.node"));
}

/**
 * Vendored data assets a server reads at runtime relative to its bundle (`import.meta.dirname`
 * is the zip root on Lambda): everything under `<package>/src/data/` lands in `<stage>/data/`
 * (e.g. server-census's table index, #175). Nothing to do for packages without one.
 */
function copyDataAssets() {
  const src = join(pkgRoot, "src", "data");
  if (!existsSync(src)) return;
  cpSync(src, join(stageDir, "data"), { recursive: true });
}

function zip() {
  // Deterministic, directory-aware zip of the staged tree via Python's stdlib.
  execFileSync(
    "python3",
    [
      "-c",
      "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2])",
      zipPath.replace(/\.zip$/, ""),
      stageDir,
    ],
    { stdio: "inherit" },
  );
}

const catalog = resolveCatalog();
rmSync(stageDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(stageDir, { recursive: true });

await esbuildBundle();
copyBetterSqlite3();
copyFileSync(catalog, join(stageDir, CATALOG_BASENAME));
copyDataAssets();
zip();

process.stdout.write(`bundled ${zipPath} (catalog: ${catalog})\n`);

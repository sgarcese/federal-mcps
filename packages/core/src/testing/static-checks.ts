import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { formatViolations } from "./contract.js";
import type { ContractReport, Violation } from "./types.js";

/**
 * The source-level half of the contract: "quota is a shared resource — all
 * upstream calls go through the core HTTP client; no direct `fetch` to an
 * agency host" (CLAUDE.md, ADR-001 §3).
 *
 * A rule that only inspects a server definition cannot see a module that
 * quietly imports axios, so this one reads the source. It is deliberately a
 * regex scan, not a type-aware pass: it must stay fast, dependency-free and
 * obvious to the person whose build it just failed.
 */

/** HTTP libraries a server must not reach for; core's client is the only door. */
export const FETCH_MODULES: readonly string[] = ["node-fetch", "undici", "axios", "got"];

/**
 * Agency hosts the family talks to. A literal here outside a source-declaration
 * file means someone is building a URL where core should be.
 */
export const AGENCY_HOSTNAMES: readonly string[] = [
  "api.bls.gov",
  "download.bls.gov",
  "data.bls.gov",
  "api.census.gov",
  "data.cdc.gov",
];

/** Files that legitimately name agency hosts: describe_source's homepage and citation URLs. */
export const SOURCE_DECLARATION_FILES: readonly string[] = ["source.ts", "describe-source.ts"];

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "cdk.out",
  "fixtures",
  "__fixtures__",
]);

const IMPORT_PATTERN = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
/** A bare `fetch(` call: preceded by nothing, whitespace or punctuation, but never a dot. */
const GLOBAL_FETCH_PATTERN = /(?:^|[^.\w$])fetch\s*\(/;

export interface StaticCheckOptions {
  /** Override the agency host list (a new agency server adds its own). */
  readonly hostnames?: readonly string[];
}

/**
 * Scans every `.ts` file under `dir`, skipping tests, declaration files,
 * `__fixtures__` and build output. Returns a report shaped like the definition
 * contract's, so a server's contract test reads the same either way.
 */
export async function checkServerSources(
  dir: string | URL,
  options: StaticCheckOptions = {},
): Promise<ContractReport> {
  const root = typeof dir === "string" ? dir : fileURLToPath(dir);
  const hostnames = options.hostnames ?? AGENCY_HOSTNAMES;
  const violations: Violation[] = [];

  for (const file of await collectSources(root)) {
    const contents = await readFile(file, "utf8");
    const where = relative(root, file).split(sep).join("/");
    const declaresSource = SOURCE_DECLARATION_FILES.includes(basename(file));

    contents.split(/\r?\n/).forEach((line, index) => {
      if (isComment(line)) {
        return;
      }
      const at = `${where}:${index + 1}`;

      IMPORT_PATTERN.lastIndex = 0;
      for (const match of line.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1] ?? "";
        const module = FETCH_MODULES.find(
          (candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`),
        );
        if (module !== undefined) {
          violations.push({
            rule: "static-no-direct-fetch",
            message: `${at}: imports ${module}; upstream calls go through core's HTTP client (retry, backoff, budget, cache)`,
          });
        }
      }

      if (GLOBAL_FETCH_PATTERN.test(line)) {
        violations.push({
          rule: "static-no-direct-fetch",
          message: `${at}: calls global fetch(); upstream calls go through core's HTTP client (retry, backoff, budget, cache)`,
        });
      }

      if (!declaresSource) {
        for (const hostname of hostnames) {
          if (line.includes(hostname)) {
            violations.push({
              rule: "static-no-agency-hostname",
              message: `${at}: names the agency host ${hostname}; agency URLs belong in the source declaration (${SOURCE_DECLARATION_FILES.join(" or ")}) and are fetched through core`,
            });
          }
        }
      }
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    checked: ["static-no-direct-fetch", "static-no-agency-hostname"],
  };
}

/** Throws one error listing every source-level violation; resolves when clean. */
export async function assertServerSources(
  dir: string | URL,
  options: StaticCheckOptions = {},
): Promise<void> {
  const report = await checkServerSources(dir, options);
  if (report.ok) {
    return;
  }
  throw new Error(formatViolations("source calls agencies directly", report.violations));
}

async function collectSources(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...(await collectSources(path)));
      }
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && !isTestFile(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}

function isTestFile(name: string): boolean {
  return name.endsWith(".test.ts") || name.endsWith(".contract.test.ts");
}

/** Line comments and JSDoc bodies: documentation naming a host is not a call to it. */
function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

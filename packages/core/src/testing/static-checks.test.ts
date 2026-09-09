import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { assertServerSources, checkServerSources } from "./static-checks.js";

/**
 * The scanner needs a `src/` tree of deliberately offending TypeScript. Those
 * files are written to a temp directory rather than checked in under
 * `__fixtures__/`, because a checked-in file importing `axios` would fail the
 * repository's own typecheck and lint before this suite ever ran.
 */
let root: string;

const CLEAN = `import { httpClient } from "@federal-mcps/core";
export async function load(): Promise<string> {
  return httpClient.getText("laus");
}
`;

const OFFENDER = `import axios from "axios";
export async function load(): Promise<unknown> {
  const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/");
  return axios.get("x").then(() => response);
}
`;

const SOURCE_FILE = `export const source = {
  homepage: "https://data.bls.gov/cew/",
  url: "https://api.bls.gov/publicAPI/v2/",
};
`;

const COMMENTED = `// The core client talks to api.bls.gov; never call fetch( here.
/** See https://data.cdc.gov for the Socrata endpoint. */
export const NOTE = "documented, not called";
`;

const TEST_FILE = `import axios from "axios";
export const inTestsOnly = axios;
`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "federal-mcps-static-"));
  await mkdir(join(root, "nested"), { recursive: true });
  await mkdir(join(root, "__fixtures__"), { recursive: true });
  await writeFile(join(root, "clean.ts"), CLEAN, "utf8");
  await writeFile(join(root, "nested", "offender.ts"), OFFENDER, "utf8");
  await writeFile(join(root, "source.ts"), SOURCE_FILE, "utf8");
  await writeFile(join(root, "notes.ts"), COMMENTED, "utf8");
  await writeFile(join(root, "clean.test.ts"), TEST_FILE, "utf8");
  await writeFile(join(root, "__fixtures__", "recorded.ts"), OFFENDER, "utf8");
});

describe("checkServerSources", () => {
  it("flags a fetch-library import, a global fetch call and an agency hostname", async () => {
    const report = await checkServerSources(root);
    expect(report.ok).toBe(false);
    const offending = report.violations.filter((each) => each.message.includes("offender.ts"));
    expect(offending.map((each) => each.rule).sort()).toEqual([
      "static-no-agency-hostname",
      "static-no-direct-fetch",
      "static-no-direct-fetch",
    ]);
    for (const violation of offending) {
      expect(violation.message).toMatch(/offender\.ts:\d+:/);
    }
  });

  it("names the imported module and the hostname it found", async () => {
    const report = await checkServerSources(root);
    const messages = report.violations.map((each) => each.message).join("\n");
    expect(messages).toContain("axios");
    expect(messages).toContain("api.bls.gov");
  });

  it("allows agency hostnames in source.ts, where describe_source declares them", async () => {
    const report = await checkServerSources(root);
    expect(report.violations.filter((each) => each.message.includes("source.ts"))).toEqual([]);
  });

  it("ignores comments, test files and __fixtures__", async () => {
    const report = await checkServerSources(root);
    const ignored = report.violations.filter((each) =>
      ["notes.ts", "clean.test.ts", "recorded.ts"].some((name) => each.message.includes(name)),
    );
    expect(ignored).toEqual([]);
  });

  it("reports the rules it checked and passes a clean tree", async () => {
    const cleanRoot = await mkdtemp(join(tmpdir(), "federal-mcps-clean-"));
    await writeFile(join(cleanRoot, "clean.ts"), CLEAN, "utf8");
    const report = await checkServerSources(cleanRoot);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checked).toEqual(["static-no-direct-fetch", "static-no-agency-hostname"]);
  });

  it("accepts a file: URL, so servers can pass new URL('../src', import.meta.url)", async () => {
    const report = await checkServerSources(pathToFileURL(root));
    expect(report.ok).toBe(false);
  });
});

describe("assertServerSources", () => {
  it("throws one error listing every violation", async () => {
    const error = await assertServerSources(root).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("static-no-direct-fetch");
    expect((error as Error).message).toContain("static-no-agency-hostname");
  });

  it("resolves for a tree that calls no agency directly", async () => {
    const cleanRoot = await mkdtemp(join(tmpdir(), "federal-mcps-clean-"));
    await writeFile(join(cleanRoot, "clean.ts"), CLEAN, "utf8");
    await expect(assertServerSources(cleanRoot)).resolves.toBeUndefined();
  });
});

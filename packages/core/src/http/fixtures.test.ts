import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MissingFixtureError } from "./errors.js";
import { fixturePath, readFixture, resolveFixtureMode, writeFixture } from "./fixtures.js";

describe("resolveFixtureMode", () => {
  const originalEnv = process.env.FIXTURES;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FIXTURES;
    } else {
      process.env.FIXTURES = originalEnv;
    }
  });

  it("prefers an explicit override over the environment", () => {
    process.env.FIXTURES = "replay";
    expect(resolveFixtureMode("record")).toBe("record");
  });

  it("falls back to process.env.FIXTURES", () => {
    process.env.FIXTURES = "replay";
    expect(resolveFixtureMode()).toBe("replay");
  });

  it("defaults to off when nothing is set", () => {
    delete process.env.FIXTURES;
    expect(resolveFixtureMode()).toBe("off");
  });
});

describe("fixturePath", () => {
  it("is <dir>/<source>/<sha256(url)>.json", () => {
    const path = fixturePath("fixtures", "bls", "https://api.bls.gov/x");
    expect(path).toMatch(/^fixtures\/bls\/[0-9a-f]{64}\.json$/);
  });
});

describe("writeFixture / readFixture", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "federal-mcps-fixtures-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("records a response and replays the exact same body/status/headers", async () => {
    const url = "https://api.bls.gov/x";
    await writeFixture(
      dir,
      "bls",
      url,
      { status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' },
      () => new Date("2026-09-08T12:00:00.000Z"),
    );

    const replayed = await readFixture(dir, "bls", url);
    expect(replayed).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    });

    const path = fixturePath(dir, "bls", url);
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    expect(onDisk.recordedAt).toBe("2026-09-08T12:00:00.000Z");
    expect(onDisk.url).toBe(url);
  });

  it("throws MissingFixtureError naming the exact path when absent", async () => {
    const url = "https://api.bls.gov/missing";
    const expectedPath = fixturePath(dir, "bls", url);
    await expect(readFixture(dir, "bls", url)).rejects.toMatchObject({
      path: expectedPath,
    });
    await expect(readFixture(dir, "bls", url)).rejects.toBeInstanceOf(MissingFixtureError);
  });
});

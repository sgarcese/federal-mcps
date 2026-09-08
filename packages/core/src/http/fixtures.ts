import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MissingFixtureError } from "./errors.js";

/**
 * Fixture record/replay (issue #5). `record` performs the real fetch and
 * writes the response to disk; `replay` (the test default) serves from disk
 * and never touches the network; `off` bypasses fixtures entirely.
 */
export type FixtureMode = "record" | "replay" | "off";

export interface FixtureResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

interface FixtureRecord extends FixtureResponse {
  readonly url: string;
  readonly recordedAt: string;
}

const FIXTURE_MODES: ReadonlySet<string> = new Set(["record", "replay", "off"]);

/** `override` wins; otherwise `process.env.FIXTURES`; otherwise "off". */
export function resolveFixtureMode(override?: FixtureMode): FixtureMode {
  if (override) {
    return override;
  }
  // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under exactOptionalPropertyTypes/noPropertyAccessFromIndexSignature.
  const fromEnv = process.env["FIXTURES"];
  if (fromEnv && FIXTURE_MODES.has(fromEnv)) {
    return fromEnv as FixtureMode;
  }
  return "off";
}

export function fixturePath(dir: string, source: string, url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return join(dir, source, `${hash}.json`);
}

export async function writeFixture(
  dir: string,
  source: string,
  url: string,
  response: FixtureResponse,
  now: () => Date = () => new Date(),
): Promise<void> {
  const path = fixturePath(dir, source, url);
  await mkdir(dirname(path), { recursive: true });
  const record: FixtureRecord = {
    url,
    status: response.status,
    headers: response.headers,
    body: response.body,
    recordedAt: now().toISOString(),
  };
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function readFixture(
  dir: string,
  source: string,
  url: string,
): Promise<FixtureResponse> {
  const path = fixturePath(dir, source, url);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) {
      throw new MissingFixtureError({ source, url, path });
    }
    throw err;
  }
  const record = JSON.parse(raw) as FixtureRecord;
  return { status: record.status, headers: record.headers, body: record.body };
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

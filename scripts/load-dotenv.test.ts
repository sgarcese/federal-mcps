import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * scripts/load-dotenv.sh, sourced by deploy.sh (#349): `.env` is always read when present, even
 * when the shell already holds BLS_API_KEY (the 2026-10-06 deploy skipped it and shipped every
 * Lambda without the limiter secrets), and a missing limiter secret is warned about, not silent.
 */
const LOADER = join(import.meta.dirname, "load-dotenv.sh");

function run(envFile: string, shellEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dotenv-"));
  writeFileSync(join(dir, ".env"), envFile);
  try {
    const res = spawnSync(
      "bash",
      [
        "-c",
        `source "${LOADER}"; load_dotenv; printf 'caller=%s operator=%s bls=%s\\n' "\${FEDERAL_MCPS_CALLER_SECRET:+set}" "\${FEDERAL_MCPS_OPERATOR_TOKEN:+set}" "\${BLS_API_KEY:-}"`,
      ],
      { cwd: dir, env: { PATH: process.env.PATH ?? "", ...shellEnv }, encoding: "utf8" },
    );
    return { stdout: res.stdout, stderr: res.stderr, status: res.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("load-dotenv.sh (#349)", () => {
  it("reads .env even when BLS_API_KEY is already in the shell", () => {
    const res = run(
      "FEDERAL_MCPS_CALLER_SECRET=s3cret-value\nFEDERAL_MCPS_OPERATOR_TOKEN=t0ken-value\n",
      {
        BLS_API_KEY: "from-shell",
      },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("caller=set operator=set");
  });

  it("lets .env win over a stale shell value", () => {
    const res = run("BLS_API_KEY=from-dotenv\n", { BLS_API_KEY: "stale-shell" });
    expect(res.stdout).toContain("bls=from-dotenv");
  });

  it("warns on stderr, without printing any value, when a limiter secret is missing", () => {
    const res = run("BLS_API_KEY=k\nFEDERAL_MCPS_OPERATOR_TOKEN=t0ken-value\n");
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/FEDERAL_MCPS_CALLER_SECRET is not set/);
    expect(res.stderr).not.toMatch(/FEDERAL_MCPS_OPERATOR_TOKEN is not set/);
    expect(`${res.stdout}${res.stderr}`).not.toContain("t0ken-value");
  });

  it("does nothing, and does not fail, when there is no .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "dotenv-"));
    try {
      const res = spawnSync("bash", ["-c", `source "${LOADER}"; load_dotenv; echo ok`], {
        cwd: dir,
        env: { PATH: process.env.PATH ?? "" },
        encoding: "utf8",
      });
      expect(res.stdout).toContain("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

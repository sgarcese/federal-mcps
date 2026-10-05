import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * scripts/admin-grant-protection.sh (#320, ADR-020 §10): the idempotent, administrator-run grant
 * that makes M17's limiter possible — the limits table, per-execution-role DynamoDB rights,
 * rc-deploy's monitoring rights, the cost-allocation tag and a concurrency report. Never calls
 * AWS in this suite: --dry-run must print every call it would make (and the policy documents)
 * without touching a real `aws` binary, which this test enforces with a fake `aws` on PATH that
 * fails the test if it is ever actually invoked.
 */
const repoRoot = join(import.meta.dirname, "..");
const SCRIPT = join(repoRoot, "scripts", "admin-grant-protection.sh");

let binDir: string;

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), "admin-grant-protection-fakebin-"));
  // A fake `aws` that must never run under --dry-run: if invoked, it records the fact and
  // exits nonzero, so any accidental real call fails the test loudly instead of hanging on
  // real credentials or silently succeeding.
  const fakeAws = join(binDir, "aws");
  writeFileSync(fakeAws, `#!/usr/bin/env bash\necho "FAKE_AWS_WAS_CALLED: $*" >&2\nexit 1\n`);
  chmodSync(fakeAws, 0o755);
});

afterEach(() => {
  rmSync(binDir, { recursive: true, force: true });
});

function runDryRun(args: string[] = []): string {
  return execFileSync("bash", [SCRIPT, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
  });
}

describe("admin-grant-protection.sh --dry-run", () => {
  it("never calls aws", () => {
    // A thrown error here would carry the fake aws's stderr, which names the call that
    // slipped through — see FAKE_AWS_WAS_CALLED above.
    expect(() => runDryRun(["dev", "--dry-run"])).not.toThrow();
  });

  it("names the limits table, its key and its TTL attribute", () => {
    const out = runDryRun(["dev", "--dry-run"]);
    expect(out).toContain("rc-federal-mcps-dev-limits");
    expect(out).toMatch(/AttributeName=pk,AttributeType=S/);
    expect(out).toMatch(/expiresAt/);
  });

  it("grants dynamodb:UpdateItem and GetItem, scoped to that table's ARN, to bls/census/hud/bea/geo roles only", () => {
    const out = runDryRun(["dev", "--dry-run"]);
    const tableArnFragment = "table/rc-federal-mcps-dev-limits";
    for (const role of [
      "rc-bls-mcp-dev-role",
      "rc-census-mcp-dev-role",
      "rc-huduser-mcp-dev-role",
      "rc-bea-mcp-dev-role",
      "rc-geo-mcp-dev-role",
    ]) {
      expect(out).toContain(role);
    }
    // the CDC portal role is never touched by this script
    expect(out).not.toContain("rc-cdc-mcp-dev-role");

    const policyBlocks = out.match(/\{[^{}]*"dynamodb:UpdateItem"[^{}]*\}/gs) ?? [];
    expect(policyBlocks.length).toBeGreaterThan(0);
    for (const block of policyBlocks) {
      expect(block).toContain("dynamodb:GetItem");
      expect(block).toContain(tableArnFragment);
    }
  });

  it("grants rc-deploy CloudWatch, SNS and Budgets rights scoped to rc-* names where the service allows it", () => {
    const out = runDryRun(["dev", "--dry-run"]);
    expect(out).toContain("rc-deploy");
    expect(out).toMatch(/PutMetricAlarm/);
    expect(out).toMatch(/DeleteAlarms/);
    expect(out).toMatch(/PutDashboard/);
    expect(out).toMatch(/GetDashboard/);
    expect(out).toMatch(/DeleteDashboards/);
    expect(out).toMatch(/sns:CreateTopic/);
    expect(out).toMatch(/sns:Subscribe/);
    expect(out).toMatch(/budgets:ModifyBudget/);
    expect(out).toMatch(/budgets:ViewBudget/);
    // Scoped names, not a blanket "*" everywhere a service supports resource ARNs.
    expect(out).toMatch(/dashboard\/rc-\*/);
    expect(out).toMatch(/alarm:rc-\*/);
    expect(out).toMatch(/:sns:[^"]*:rc-\*/);
    expect(out).toMatch(/budget\/rc-\*/);
  });

  it("activates the project cost-allocation tag", () => {
    const out = runDryRun(["dev", "--dry-run"]);
    expect(out).toMatch(/update-cost-allocation-tags-status/);
    expect(out).toMatch(/"TagKey":\s*"project"/);
    expect(out).toMatch(/"Status":\s*"Active"/);
  });

  it("reports account Lambda concurrency and would warn against the M17 defaults", () => {
    const out = runDryRun(["dev", "--dry-run"]);
    expect(out).toMatch(/get-account-settings/);
  });

  it("defaults to the dev instance when none is given", () => {
    const out = runDryRun(["--dry-run"]);
    expect(out).toContain("rc-federal-mcps-dev-limits");
  });

  it("touches only the five non-CDC execution roles, never any other role name", () => {
    const out = runDryRun(["dev", "--dry-run"]);
    const roleMentions = out.match(/rc-[a-z-]+-mcp-dev-role/g) ?? [];
    const unique = new Set(roleMentions);
    for (const role of unique) {
      expect(role).not.toBe("rc-cdc-mcp-dev-role");
    }
    expect(unique.size).toBe(5);
  });
});

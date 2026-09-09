import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backendConfigFlags, loadInstances, selectInstance, stateBucket } from "./instance.mjs";

const repoRoot = join(import.meta.dirname, "..");

/**
 * The files git tracks under the given repo-relative dirs — never untracked, gitignored
 * local artifacts (a developer's `terraform/bootstrap/` state, a `.terraform/` cache). The
 * property under test is "no account/zone/domain literal is *committed* outside the fleet
 * record", so the scan must match git's view, not the raw filesystem (#67).
 */
function trackedFiles(...dirs: string[]): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", ...dirs], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  return out
    .split("\0")
    .filter((f) => f.length > 0)
    .map((f) => join(repoRoot, f));
}

/** Files whose content contains `literal` — the offenders the guard must find. */
function findOffenders(files: string[], literal: string): string[] {
  return files.filter((file) => readFileSync(file, "utf-8").includes(literal));
}

describe("instance record loader", () => {
  it("selects dev by default and validates the record shape", () => {
    const dev = selectInstance();
    expect(dev.name).toBe("dev");
    expect(dev.terraform.stateBucket).toBe(`rc-tfstate-${dev.account}`);
    expect(loadInstances().map((i) => i.name)).toContain("dev");
  });

  it("carries the geo server's name and domain alongside the bls server's (#58)", () => {
    // Shape only — the exact literals live in the terraform tests (excluded from the
    // scan below), so this file never embeds a value the fleet record alone should own.
    const dev = selectInstance();
    for (const service of [dev.naming.blsService, dev.naming.geoService]) {
      expect(service).toMatch(/^rc-[a-z-]+$/);
    }
    for (const domain of [dev.domain.blsDomainName, dev.domain.geoDomainName]) {
      expect(domain.endsWith(`.${dev.domain.hostedZoneName}`)).toBe(true);
    }
    expect(dev.naming.geoService).not.toBe(dev.naming.blsService);
    expect(dev.domain.geoDomainName).not.toBe(dev.domain.blsDomainName);
  });

  it("throws a clear error naming known instances for an unknown name", () => {
    expect(() => selectInstance("nope")).toThrow(/Unknown federal-mcps instance "nope".*dev/);
  });

  it("derives the state bucket and backend flags from the record", () => {
    const dev = selectInstance();
    expect(stateBucket(dev)).toBe(`rc-tfstate-${dev.account}`);
    expect(backendConfigFlags(dev)).toEqual([
      `-backend-config=bucket=rc-tfstate-${dev.account}`,
      "-backend-config=key=rc/federal-mcps/dev/terraform.tfstate",
      `-backend-config=region=${dev.region}`,
    ]);
  });
});

describe("the fleet record is the only place an account, zone or domain is written", () => {
  const dev = selectInstance();
  const literals = [
    dev.account,
    dev.domain.hostedZoneId,
    dev.domain.blsDomainName,
    dev.domain.geoDomainName,
  ];
  // Git-tracked files only, so a developer's gitignored local terraform state never turns
  // this into a false-positive red (#67). `.tftest.hcl` files legitimately pin these values.
  const scanned = trackedFiles("terraform", "scripts", ".github").filter(
    (f) => !f.endsWith(".tftest.hcl"),
  );

  it.each(literals)("%s appears nowhere under terraform/, scripts/ or .github/", (literal) => {
    expect(findOffenders(scanned, literal)).toEqual([]);
  });

  it("still catches a committed literal outside the fleet record (guard preserved)", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-guard-"));
    try {
      const clean = join(dir, "clean.tf");
      const offender = join(dir, "leak.tf");
      writeFileSync(clean, 'region = "us-east-1"\n');
      writeFileSync(offender, `account = "${dev.account}"\n`);
      expect(findOffenders([clean], dev.account)).toEqual([]);
      expect(findOffenders([clean, offender], dev.account)).toEqual([offender]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backendConfigFlags, loadInstances, selectInstance, stateBucket } from "./instance.mjs";

const repoRoot = join(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === ".terraform") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
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
  const scanned = [
    ...walk(join(repoRoot, "terraform")),
    ...walk(join(repoRoot, "scripts")),
    ...walk(join(repoRoot, ".github")),
  ].filter((f) => !f.endsWith(".tftest.hcl"));

  it.each(literals)("%s appears nowhere under terraform/, scripts/ or .github/", (literal) => {
    const offenders = scanned.filter((file) => readFileSync(file, "utf-8").includes(literal));
    expect(offenders).toEqual([]);
  });
});

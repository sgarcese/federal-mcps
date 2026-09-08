import { describe, expect, it } from "vitest";
import { deployConcurrencyGroup, loadInstances, selectInstance } from "../lib/instances.js";

describe("loadInstances", () => {
  it("parses instances.json into an array of instance records", () => {
    const instances = loadInstances();
    expect(instances.length).toBeGreaterThan(0);
    expect(instances[0]?.name).toBe("dev");
  });
});

describe("selectInstance", () => {
  it("selects dev by default", () => {
    const instance = selectInstance();
    expect(instance.name).toBe("dev");
  });

  it("selects the instance named by FEDERAL_MCPS_INSTANCE when no explicit name is given", () => {
    const previous = process.env["FEDERAL_MCPS_INSTANCE"];
    process.env["FEDERAL_MCPS_INSTANCE"] = "dev";
    try {
      const instance = selectInstance();
      expect(instance.name).toBe("dev");
    } finally {
      if (previous === undefined) {
        delete process.env["FEDERAL_MCPS_INSTANCE"];
      } else {
        process.env["FEDERAL_MCPS_INSTANCE"] = previous;
      }
    }
  });

  it("throws a clear error naming the known instances for an unknown name", () => {
    expect(() => selectInstance("nonexistent")).toThrowError(
      /Unknown federal-mcps instance "nonexistent".*dev/s,
    );
  });

  it("the dev record's deployRoleArn matches the account's github-deploy role", () => {
    const instance = selectInstance("dev");
    expect(instance.deployRoleArn).toBe(
      `arn:aws:iam::${instance.account}:role/federal-mcps-github-deploy`,
    );
  });
});

describe("deployConcurrencyGroup", () => {
  it("returns deploy-<instance name>, the group #10's deploy.yml must use", () => {
    const instance = selectInstance("dev");
    expect(deployConcurrencyGroup(instance)).toBe("deploy-dev");
  });
});

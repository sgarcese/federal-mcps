import { describe, expect, it } from "vitest";
import { assertFamilyContract, checkFamilyContract } from "./contract.js";
import * as broken from "./__fixtures__/broken.js";
import { compliantDefinition } from "./__fixtures__/compliant.js";
import { FAMILY_VERB_PARAMETERS } from "./rules/verbs.js";

/** Rule ids a report fired, deduplicated, for compact assertions. */
function rules(violations: readonly { rule: string }[]): string[] {
  return [...new Set(violations.map((violation) => violation.rule))].sort();
}

describe("checkFamilyContract", () => {
  it("passes the compliant definition with no violations", async () => {
    const report = await checkFamilyContract(compliantDefinition);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("reports which rules it checked", async () => {
    const report = await checkFamilyContract(compliantDefinition);
    expect(report.checked).toContain("tool-name-format");
    expect(report.checked).toContain("examples-run");
    expect(new Set(report.checked).size).toBe(report.checked.length);
  });

  it("collects every violation rather than stopping at the first", async () => {
    const report = await checkFamilyContract(broken.missingPrefix);
    expect(report.ok).toBe(false);
    expect(report.violations.length).toBeGreaterThan(0);
    for (const violation of report.violations) {
      expect(violation.message).not.toBe("");
    }
  });
});

describe("tool-name-format", () => {
  it("rejects a name outside ^[a-z][a-z0-9_]{0,63}$", async () => {
    const report = await checkFamilyContract(broken.badToolName);
    expect(rules(report.violations)).toContain("tool-name-format");
    expect(report.violations[0]?.tool).toBe("demo_Get-Raw");
  });

  it("rejects a name longer than 64 characters", async () => {
    const report = await checkFamilyContract(broken.overlongToolName);
    expect(rules(report.violations)).toContain("tool-name-format");
  });
});

describe("tool-name-prefix", () => {
  it("rejects a tool that does not start with the agency prefix", async () => {
    const report = await checkFamilyContract(broken.missingPrefix);
    const violation = report.violations.find((each) => each.rule === "tool-name-prefix");
    expect(violation?.message).toContain("demo_");
  });
});

describe("tool-description", () => {
  it("rejects an empty description", async () => {
    const report = await checkFamilyContract(broken.emptyDescription);
    expect(rules(report.violations)).toContain("tool-description");
  });

  it("rejects a description longer than 1,000 characters", async () => {
    const report = await checkFamilyContract(broken.overlongDescription);
    expect(rules(report.violations)).toContain("tool-description");
  });
});

describe("verb-parameters", () => {
  it("encodes the family verb parameter table for the shell and servers to share", () => {
    expect(FAMILY_VERB_PARAMETERS).toEqual({
      resolve_place: ["query"],
      list_indicators: [],
      get_indicator: ["indicator", "place"],
      compare_places: ["indicator", "places"],
      get_raw: ["ids"],
      describe_source: [],
    });
  });

  it("rejects a verb tool missing a required parameter", async () => {
    const report = await checkFamilyContract(broken.verbMissingParameters);
    const violation = report.violations.find((each) => each.rule === "verb-parameters");
    expect(violation?.message).toContain("ids");
  });

  it("rejects a verb tool whose input is not an object schema", async () => {
    const report = await checkFamilyContract(broken.verbNonObjectInput);
    expect(rules(report.violations)).toContain("verb-parameters");
  });
});

describe("describe-source-present", () => {
  it("rejects a describeSource whose agency disagrees with the definition", async () => {
    const report = await checkFamilyContract(broken.describeSourceAgencyMismatch);
    expect(rules(report.violations)).toContain("describe-source-present");
  });

  it("rejects a describeSource with no programs", async () => {
    const report = await checkFamilyContract(broken.describeSourceNoPrograms);
    expect(rules(report.violations)).toContain("describe-source-present");
  });
});

describe("describe-source-duplicate", () => {
  it("rejects a definition that declares the tool the shell auto-registers", async () => {
    const report = await checkFamilyContract(broken.duplicateDescribeSource);
    expect(rules(report.violations)).toContain("describe-source-duplicate");
  });
});

describe("no-own-resolve-place", () => {
  it("rejects a server that ships its own place lookup", async () => {
    const report = await checkFamilyContract(broken.ownResolvePlace);
    const violation = report.violations.find((each) => each.rule === "no-own-resolve-place");
    expect(violation?.message).toContain("ADR-003");
  });
});

describe("examples-run", () => {
  it("rejects a tool with no examples", async () => {
    const report = await checkFamilyContract(broken.noExamples);
    expect(rules(report.violations)).toContain("examples-run");
  });

  it("rejects an example input that fails the tool's own schema", async () => {
    const report = await checkFamilyContract(broken.exampleFailsSchema);
    const violation = report.violations.find((each) => each.rule === "examples-run");
    expect(violation?.message).toContain("wrong shape");
  });

  it("rejects a handler that throws", async () => {
    const report = await checkFamilyContract(broken.handlerThrows);
    const violation = report.violations.find((each) => each.rule === "examples-run");
    expect(violation?.message).toContain("upstream exploded");
  });

  it("rejects a result that does not wrap into a valid envelope", async () => {
    const report = await checkFamilyContract(broken.handlerReturnsUnwrappable);
    expect(rules(report.violations)).toContain("examples-run");
  });
});

describe("slow-example", () => {
  it("flags an example slower than the budget", async () => {
    const report = await checkFamilyContract(broken.slowHandler, { slowExampleMs: 1 });
    expect(rules(report.violations)).toContain("slow-example");
  });

  it("does not flag a fast example at the default budget", async () => {
    const report = await checkFamilyContract(broken.slowHandler);
    expect(rules(report.violations)).not.toContain("slow-example");
  });
});

describe("assertFamilyContract", () => {
  it("resolves for a compliant definition", async () => {
    await expect(assertFamilyContract(compliantDefinition)).resolves.toBeUndefined();
  });

  it("throws one error listing every violation", async () => {
    const report = await checkFamilyContract(broken.missingPrefix);
    const error = await assertFamilyContract(broken.missingPrefix).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    for (const violation of report.violations) {
      expect(message).toContain(violation.rule);
      expect(message).toContain(violation.message);
    }
  });
});

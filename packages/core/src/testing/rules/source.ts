import { describeSourceToolName } from "../../server/definition.js";
import type { ContractRule, Violation } from "../types.js";
import { familyVerbOf } from "./verbs.js";

/**
 * `describe_source` and `resolve_place`: the two tools a server does not own.
 *
 * The shell (#6) auto-registers `${agency}_describe_source` from
 * `definition.describeSource()`, and geography comes from core (ADR-003 §8), so
 * a definition that declares either tool itself is wrong twice over — it
 * duplicates a registration and it forks a shared behaviour.
 */

export const describeSourceRule: ContractRule = {
  ids: ["describe-source-present", "describe-source-duplicate"],
  run: ({ definition }) => {
    const violations: Violation[] = [];
    const expected = describeSourceToolName(definition.agency);

    if (typeof definition.describeSource !== "function") {
      violations.push({
        rule: "describe-source-present",
        message: `describeSource must be a function returning a SourceDescription; the shell registers ${expected} from it`,
      });
    } else {
      let description: ReturnType<typeof definition.describeSource> | undefined;
      try {
        description = definition.describeSource();
      } catch (error) {
        violations.push({
          rule: "describe-source-present",
          message: `describeSource() threw: ${errorText(error)}`,
        });
      }
      if (description !== undefined) {
        if (description.agency !== definition.agency) {
          violations.push({
            rule: "describe-source-present",
            message: `describeSource().agency is ${JSON.stringify(description.agency)} but the definition's agency is ${JSON.stringify(definition.agency)}`,
          });
        }
        if (!Array.isArray(description.programs) || description.programs.length === 0) {
          violations.push({
            rule: "describe-source-present",
            message:
              "describeSource().programs is empty; describe_source exists to tell the model what this server covers",
          });
        }
      }
    }

    for (const tool of definition.tools) {
      if (familyVerbOf(tool.name) === "describe_source") {
        violations.push({
          rule: "describe-source-duplicate",
          tool: tool.name,
          message: `the shell registers ${expected} from describeSource(); a definition must not declare it too`,
        });
      }
    }
    return violations;
  },
};

export const resolvePlaceRule: ContractRule = {
  ids: ["no-own-resolve-place"],
  run: ({ definition }) => {
    const violations: Violation[] = [];
    for (const tool of definition.tools) {
      if (familyVerbOf(tool.name) === "resolve_place" && tool.fromCore !== true) {
        violations.push({
          rule: "no-own-resolve-place",
          tool: tool.name,
          message:
            "only core resolves places (ADR-003 §8): no server ships its own name lookup or FIPS table. " +
            "a resolve_place tool must come from core.geographyTools() (its `fromCore` flag), not be hand-declared",
        });
      }
    }
    return violations;
  },
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

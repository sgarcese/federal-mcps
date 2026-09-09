import { z } from "zod";
import { type FamilyVerb, FAMILY_VERBS } from "../../index.js";
import type { ContractRule, Violation } from "../types.js";

/**
 * The family verb parameter table (docs/architecture.md "Family verbs",
 * ADR-001 §2). A tool whose name ends in a verb must accept at least these
 * keys; optional parameters (`start`, `end`, `kind`, `topic`, `period`) are the
 * server's choice, so only the required set is listed.
 *
 * Exported so the shell (#6) and agency servers (#8) build inputs from the same
 * table the contract suite checks them against.
 */
export const FAMILY_VERB_PARAMETERS: Readonly<Record<FamilyVerb, readonly string[]>> =
  Object.freeze({
    resolve_place: ["query"],
    list_indicators: [],
    get_indicator: ["indicator", "place"],
    compare_places: ["indicator", "places"],
    get_raw: ["ids"],
    describe_source: [],
  });

/** The family verb a tool name ends in, if any. `bls_get_raw` → `get_raw`. */
export function familyVerbOf(name: string): FamilyVerb | undefined {
  return FAMILY_VERBS.find((verb) => name === verb || name.endsWith(`_${verb}`));
}

/** The keys of a Zod object schema, or `undefined` when the schema is not an object. */
export function objectKeys(schema: unknown): string[] | undefined {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape as Record<string, unknown>);
  }
  return undefined;
}

export const verbParametersRule: ContractRule = {
  ids: ["verb-parameters"],
  run: ({ definition }) => {
    const violations: Violation[] = [];
    for (const tool of definition.tools) {
      const verb = familyVerbOf(tool.name);
      if (verb === undefined) {
        continue;
      }
      const keys = objectKeys(tool.input);
      if (keys === undefined) {
        violations.push({
          rule: "verb-parameters",
          tool: tool.name,
          message: `input schema must be a z.object so the ${verb} parameters can be checked (and so hosts get a usable JSON Schema)`,
        });
        continue;
      }
      const required = FAMILY_VERB_PARAMETERS[verb];
      const missing = required.filter((key) => !keys.includes(key));
      if (missing.length > 0) {
        violations.push({
          rule: "verb-parameters",
          tool: tool.name,
          message: `family verb ${verb} requires parameters ${required.join(", ")}; missing ${missing.join(", ")}`,
        });
      }
    }
    return violations;
  },
};

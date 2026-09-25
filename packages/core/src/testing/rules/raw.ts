import type { ContractRule, Violation } from "../types.js";
import { familyVerbOf } from "./verbs.js";

/**
 * `raw-rendering` (#210, ADR-017 §3): every `*_get_raw` tool declares a compact renderer and a
 * text budget. A raw tool's answer *is* its rows, and hosts that read only the text would
 * otherwise get the first 4,000 characters of an envelope JSON — too little to batch on.
 */
export const rawRenderingRule: ContractRule = {
  ids: ["raw-rendering"],
  run: (context) => {
    const violations: Violation[] = [];
    for (const tool of context.definition.tools) {
      if (familyVerbOf(tool.name) !== "get_raw") continue;
      if (typeof tool.renderData !== "function" || typeof tool.textBudget !== "number") {
        violations.push({
          rule: "raw-rendering",
          tool: tool.name,
          message:
            "a get_raw tool must declare renderData (its compact text form) and textBudget (ADR-017)",
        });
      }
    }
    return violations;
  },
};

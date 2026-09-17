import type { ContractRule, Violation } from "../types.js";

/**
 * Tool naming and description rules (ADR-001 §2–3).
 *
 * These read `definition.tools`, not a running server's `tools/list`: the
 * shell (#6) is what makes the wire view match the definition, and it registers
 * names verbatim. A later live-server variant can assert the same rules over
 * `tools/list` without changing them.
 */

/** MCP tool names: lower snake case, starting with a letter, at most 64 characters. */
export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Descriptions land in the model's context every turn; keep them short. */
export const MAX_DESCRIPTION_LENGTH = 1000;

export const toolNameRule: ContractRule = {
  ids: ["tool-name-format", "tool-name-prefix"],
  run: ({ definition }) => {
    const violations: Violation[] = [];
    const prefix = `${definition.agency}_`;
    for (const tool of definition.tools) {
      if (!TOOL_NAME_PATTERN.test(tool.name)) {
        violations.push({
          rule: "tool-name-format",
          tool: tool.name,
          message:
            `tool name ${JSON.stringify(tool.name)} (${tool.name.length} characters) must match ` +
            `${TOOL_NAME_PATTERN.source} — lower snake case, at most 64 characters`,
        });
      }
      if (!tool.name.startsWith(prefix)) {
        violations.push({
          rule: "tool-name-prefix",
          tool: tool.name,
          message: `tool name ${JSON.stringify(tool.name)} must start with the agency prefix ${JSON.stringify(prefix)}`,
        });
      }
    }
    return violations;
  },
};

export const toolDescriptionRule: ContractRule = {
  ids: ["tool-description"],
  run: ({ definition }) => {
    const violations: Violation[] = [];
    for (const tool of definition.tools) {
      const description = tool.description ?? "";
      if (description.trim() === "") {
        violations.push({
          rule: "tool-description",
          tool: tool.name,
          message: "description is empty; the model chooses tools by their description",
        });
        continue;
      }
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        violations.push({
          rule: "tool-description",
          tool: tool.name,
          message: `description is ${description.length} characters; the limit is ${MAX_DESCRIPTION_LENGTH}`,
        });
      }
    }
    return violations;
  },
};

/**
 * Every tool must carry a non-blank human-readable `title` (the directory review criteria
 * require it alongside the read-only/destructive hints, #138).
 */
export const toolTitleRule: ContractRule = {
  ids: ["tool-title"],
  run: ({ definition }) => {
    const violations: Violation[] = [];
    for (const tool of definition.tools) {
      if ((tool.title ?? "").trim() === "") {
        violations.push({
          rule: "tool-title",
          tool: tool.name,
          message: "title is blank; hosts and the connector directory show it next to the name",
        });
      }
    }
    return violations;
  },
};

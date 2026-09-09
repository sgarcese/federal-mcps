/**
 * The family contract harness (issue #7): ADR-001 §3 and ADR-003 §8 as
 * executable rules every agency server must pass.
 *
 * A server package puts one file at `src/<agency>.contract.test.ts`, which
 * `npm run test:contract` picks up across every `packages/server-*`:
 *
 * ```ts
 * import { assertFamilyContract, assertServerSources } from "@federal-mcps/core/testing";
 * import { it } from "vitest";
 * import { definition } from "./definition.js";
 *
 * it("meets the family contract", () => assertFamilyContract(definition));
 * it("does not call agencies directly", () =>
 *   assertServerSources(new URL("../src", import.meta.url)));
 * ```
 *
 * Both helpers throw a single Error listing every violation, so one failing
 * test shows the whole list. The harness itself imports no test framework —
 * `checkFamilyContract` and `checkServerSources` return structured reports for
 * anything that wants to render them differently (CI annotations, a script).
 *
 * The rules read a `ServerDefinition` and call each tool's handler with its
 * examples, rather than driving a running MCP server. The shell (#6) is what
 * makes the wire view (`tools/list`, annotations, MCP framing) match the
 * definition, and it registers names and schemas verbatim; a later live-server
 * variant can assert the same rule ids over a real `tools/list` without
 * changing any of them.
 */

export {
  assertFamilyContract,
  checkFamilyContract,
  DEFAULT_SLOW_EXAMPLE_MS,
  formatViolations,
} from "./contract.js";
export {
  CONTRACT_RULES,
  FAMILY_VERB_PARAMETERS,
  familyVerbOf,
  MAX_DESCRIPTION_LENGTH,
  TOOL_NAME_PATTERN,
} from "./rules/index.js";
export {
  AGENCY_HOSTNAMES,
  assertServerSources,
  checkServerSources,
  FETCH_MODULES,
  SOURCE_DECLARATION_FILES,
  type StaticCheckOptions,
} from "./static-checks.js";
export type {
  ContractOptions,
  ContractReport,
  ContractRule,
  RuleContext,
  Violation,
} from "./types.js";

import type { ServerDefinition } from "../server/definition.js";
import { CONTRACT_RULES } from "./rules/index.js";
import type { ContractOptions, ContractReport, RuleContext, Violation } from "./types.js";

/** Default budget for one example run before `slow-example` fires. */
export const DEFAULT_SLOW_EXAMPLE_MS = 5000;

/**
 * Checks a server definition against the family contract (ADR-001 §3,
 * ADR-003 §8) and returns everything that is wrong with it.
 *
 * Every rule runs; nothing short-circuits, so one run tells a server author the
 * whole list rather than one defect at a time.
 */
export async function checkFamilyContract(
  definition: ServerDefinition,
  options: ContractOptions = {},
): Promise<ContractReport> {
  const context: RuleContext = {
    definition,
    now: options.now ?? (() => new Date()),
    slowExampleMs: options.slowExampleMs ?? DEFAULT_SLOW_EXAMPLE_MS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };

  const violations: Violation[] = [];
  const checked: string[] = [];
  for (const rule of CONTRACT_RULES) {
    for (const id of rule.ids) {
      if (!checked.includes(id)) {
        checked.push(id);
      }
    }
    violations.push(...(await rule.run(context)));
  }

  return { ok: violations.length === 0, violations, checked };
}

/**
 * Throws one error listing every violation, so a single failing test shows a
 * server author everything to fix. Resolves silently when the definition
 * complies.
 */
export async function assertFamilyContract(
  definition: ServerDefinition,
  options: ContractOptions = {},
): Promise<void> {
  const report = await checkFamilyContract(definition, options);
  if (report.ok) {
    return;
  }
  throw new Error(
    formatViolations(`${definition.name} fails the family contract`, report.violations),
  );
}

/** Renders violations as one indented, greppable list. Shared with the static checks. */
export function formatViolations(headline: string, violations: readonly Violation[]): string {
  const lines = violations.map((violation) => {
    const where = violation.tool === undefined ? "" : ` [${violation.tool}]`;
    return `  - ${violation.rule}${where}: ${violation.message}`;
  });
  const count = violations.length === 1 ? "1 violation" : `${violations.length} violations`;
  return [`${headline} (${count}):`, ...lines].join("\n");
}

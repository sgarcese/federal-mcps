import type { ServerDefinition } from "../server/definition.js";

/**
 * One thing wrong with a server definition. `rule` is stable and greppable;
 * `tool` names the offending tool when the rule is per-tool; `message` is
 * written for the person who has to fix it and carries every detail (file and
 * line for the static checks, the failing example title, the missing key).
 */
export interface Violation {
  readonly rule: string;
  readonly tool?: string;
  readonly message: string;
}

/** The result of a whole contract run. `checked` lists the rule ids that ran. */
export interface ContractReport {
  readonly ok: boolean;
  readonly violations: Violation[];
  readonly checked: string[];
}

export interface ContractOptions {
  /** Clock handed to every handler, so example runs are deterministic. */
  readonly now?: () => Date;
  /** Budget above which an example run raises `slow-example`. Default 5,000 ms. */
  readonly slowExampleMs?: number;
  /** Passed through to handlers as `context.signal`. */
  readonly signal?: AbortSignal;
}

/** Resolved options plus the definition under test, handed to every rule. */
export interface RuleContext {
  readonly definition: ServerDefinition;
  readonly now: () => Date;
  readonly slowExampleMs: number;
  readonly signal?: AbortSignal;
}

/**
 * A contract rule. `ids` are every rule id the rule can emit, so the report's
 * `checked` list is honest even when a rule fires nothing.
 */
export interface ContractRule {
  readonly ids: readonly string[];
  readonly run: (context: RuleContext) => Violation[] | Promise<Violation[]>;
}

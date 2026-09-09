import type { ContractRule } from "../types.js";
import { examplesRule } from "./examples.js";
import { toolDescriptionRule, toolNameRule } from "./naming.js";
import { describeSourceRule, resolvePlaceRule } from "./source.js";
import { verbParametersRule } from "./verbs.js";

/**
 * Every rule the family contract enforces, in report order. Adding a rule here
 * is what makes it run and what adds its ids to a report's `checked` list.
 */
export const CONTRACT_RULES: readonly ContractRule[] = [
  toolNameRule,
  toolDescriptionRule,
  verbParametersRule,
  describeSourceRule,
  resolvePlaceRule,
  examplesRule,
];

export { examplesRule } from "./examples.js";
export {
  MAX_DESCRIPTION_LENGTH,
  TOOL_NAME_PATTERN,
  toolDescriptionRule,
  toolNameRule,
} from "./naming.js";
export { describeSourceRule, resolvePlaceRule } from "./source.js";
export { FAMILY_VERB_PARAMETERS, familyVerbOf, objectKeys, verbParametersRule } from "./verbs.js";

import { cesIndicatorDefinitions } from "./ces-indicators.js";
import { cpiIndicatorDefinitions } from "./cpi-indicators.js";
import { lausIndicatorDefinitions } from "./laus-indicators.js";
import type { IndicatorDefinition } from "./registry.js";

/**
 * Every BLS indicator this server exposes, in one place — the seam later M4 programs extend
 * (ADR-010 §1). `bls_get_indicator` builds its registry from this array; a new program (CES, OEWS,
 * CPI, JOLTS) lands by appending its definitions here, not by touching the tool. LAUS + CES so far.
 */
export const blsIndicatorDefinitions: IndicatorDefinition[] = [
  ...lausIndicatorDefinitions,
  ...cesIndicatorDefinitions,
  ...cpiIndicatorDefinitions,
];

import { lausIndicatorDefinitions } from "./laus-indicators.js";
import type { IndicatorDefinition } from "./registry.js";

/**
 * Every BLS indicator this server exposes, in one place — the seam later M4 programs extend
 * (ADR-010 §1). `bls_get_indicator` builds its registry from this array; a new program (CES, OEWS,
 * CPI, JOLTS) lands by appending its definitions here, not by touching the tool. LAUS only for now.
 */
export const blsIndicatorDefinitions: IndicatorDefinition[] = [...lausIndicatorDefinitions];

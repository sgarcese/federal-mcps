import type { IndicatorDefinition } from "@federal-mcps/core";

/**
 * Fair Market Rents and Small Area FMRs (#233) — filled in by that issue (ADR-018 §3). Each definition supplies its own `fetch` capability
 * built on `hud-api.ts` (the token arrives as `options.apiKey`), its `agencyCodeOf` from the
 * entity builders, and its caveats. Empty until then: the definition mounts the indicator tools
 * only once at least one family is present.
 */
export const fmrIndicatorDefinitions: IndicatorDefinition[] = [];

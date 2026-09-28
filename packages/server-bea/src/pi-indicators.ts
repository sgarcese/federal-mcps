import type { IndicatorDefinition } from "@federal-mcps/core";

/**
 * Personal income and per capita personal income (#259) — county (CAINC1), state (SAINC1), state quarterly (SQINC1) with the `frequency` picker, filled in by that issue (ADR-019 §2). Each definition supplies its own `fetch` built on
 * `bea-api.ts` (`beaGetData`, `beaObservation`, `vintageNote`; the key arrives as
 * `options.apiKey`), its codes from `bea-geo.ts`, and its caveats. Empty until then: the
 * definition mounts the indicator tools only once at least one family is present.
 */
export const piIndicatorDefinitions: IndicatorDefinition[] = [];

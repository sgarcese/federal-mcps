import type { IndicatorDefinition } from "@federal-mcps/core";

/**
 * GDP and real GDP by industry (#260) — county (CAGDP2/CAGDP9), state (SAGDP2/SAGDP9) with the `industry` picker, filled in by that issue (ADR-019 §2). Each definition supplies its own `fetch` built on
 * `bea-api.ts` (`beaGetData`, `beaObservation`, `vintageNote`; the key arrives as
 * `options.apiKey`), its codes from `bea-geo.ts`, and its caveats. Empty until then: the
 * definition mounts the indicator tools only once at least one family is present.
 */
export const gdpIndicatorDefinitions: IndicatorDefinition[] = [];

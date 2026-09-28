import type { IndicatorDefinition } from "@federal-mcps/core";
import { gdpIndicatorDefinitions } from "./gdp-indicators.js";
import { piIndicatorDefinitions } from "./pi-indicators.js";
import { rppIndicatorDefinitions } from "./rpp-indicators.js";

/** Every BEA Regional indicator (ADR-019 §2), one owned file per family. */
export const beaIndicatorDefinitions: IndicatorDefinition[] = [
  ...piIndicatorDefinitions,
  ...gdpIndicatorDefinitions,
  ...rppIndicatorDefinitions,
];

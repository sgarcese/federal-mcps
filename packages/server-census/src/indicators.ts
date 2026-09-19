import type { IndicatorDefinition } from "@federal-mcps/core";
import { acsIndicatorDefinitions } from "./acs-indicators.js";
import { decennialIndicatorDefinitions } from "./decennial.js";

/** Every Census indicator this server exposes — the seam later programs append to (ADR-014). */
export const censusIndicatorDefinitions: IndicatorDefinition[] = [
  ...acsIndicatorDefinitions,
  ...decennialIndicatorDefinitions,
];

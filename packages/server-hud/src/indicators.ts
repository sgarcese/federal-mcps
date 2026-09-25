import type { IndicatorDefinition } from "@federal-mcps/core";
import { chasIndicatorDefinitions } from "./chas-indicators.js";
import { fmrIndicatorDefinitions } from "./fmr-indicators.js";
import { ilIndicatorDefinitions } from "./il-indicators.js";
import { pictureIndicatorDefinitions } from "./picture-indicators.js";

/** Every HUD User indicator (ADR-018 §3), one owned file per dataset family. */
export const hudIndicatorDefinitions: IndicatorDefinition[] = [
  ...fmrIndicatorDefinitions,
  ...ilIndicatorDefinitions,
  ...chasIndicatorDefinitions,
  ...pictureIndicatorDefinitions,
];

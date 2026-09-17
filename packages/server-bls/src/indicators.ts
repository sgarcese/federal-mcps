import { cesIndicatorDefinitions } from "./ces-indicators.js";
import { cpiIndicatorDefinitions } from "./cpi-indicators.js";
import { joltsIndicatorDefinitions } from "./jt-indicators.js";
import { lausIndicatorDefinitions } from "./laus-indicators.js";
import { qcewIndicatorDefinitions } from "./qcew-indicators.js";
import { oewsIndicatorDefinitions } from "./oe-indicators.js";
import type { IndicatorDefinition } from "./registry.js";

/**
 * Every BLS indicator this server exposes, in one place — the seam new programs extend (ADR-010 §1,
 * ADR-011 §2). `bls_get_indicator` builds its registry from this array; a program lands by appending
 * its definitions here, not by touching the tool. All six BLS programs are wired: LAUS, CES, CPI,
 * OEWS, JOLTS (timeseries API) and QCEW (its own CSV client via the fetch capability).
 */
export const blsIndicatorDefinitions: IndicatorDefinition[] = [
  ...lausIndicatorDefinitions,
  ...cesIndicatorDefinitions,
  ...cpiIndicatorDefinitions,
  ...oewsIndicatorDefinitions,
  ...joltsIndicatorDefinitions,
  ...qcewIndicatorDefinitions,
];

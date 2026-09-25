import {
  type GeographyCatalog,
  geographyTools,
  type HttpClient,
  type ServerDefinition,
} from "@federal-mcps/core";
import { HUD_USER_REQUIRED_SENTENCE, describeSource } from "./describe-source.js";
import { HUD_SERVER_VERSION } from "./version.js";

/**
 * Instructions passed to the SDK so hosts surface them to the model (ADR-018 §1, §6). This
 * release ships the shell only — resolve a place, read the provenance block, no indicator
 * tools yet — so the guidance is short; later issues extend it per program.
 */
export const HUD_INSTRUCTIONS = `
This server gives HUD User Data API statistics organized by place: Fair Market Rents, Income
Limits and MTSP limits, Comprehensive Housing Affordability Strategy (CHAS) cost-burden
estimates, and the Picture of Subsidized Households. This release ships the shell only —
\`hud_resolve_place\` and \`hud_describe_source\` — every program is planned, not yet queryable;
\`hud_describe_source\` names each program's status. Resolve the place first with
\`hud_resolve_place\`, and once an indicator tool lands, cite the result's provenance block
(source, vintage, retrieval date and a ready-to-paste citation) rather than a bare number.
${HUD_USER_REQUIRED_SENTENCE} All tools are read-only.
`.trim();

export interface HudDefinitionDeps {
  catalog: GeographyCatalog;
  /**
   * The core HTTP client for the HUD User API, rate-limited per minute (ADR-018 §5). Optional
   * until the indicator tools land (#232+); the shell's tools make no upstream calls.
   */
  httpClient?: HttpClient;
  /** The HUD User bearer token (`HUD_USER_TOKEN`), read lazily; never logged or recorded. */
  token?: () => string | undefined;
}

/** The HUD User server's definition: core's resolver mounted as `hud_resolve_place`. */
export function buildHudDefinition(deps: HudDefinitionDeps): ServerDefinition {
  const catalog = () => deps.catalog;
  return {
    name: "federal-mcps-hud",
    version: HUD_SERVER_VERSION,
    agency: "hud",
    instructions: HUD_INSTRUCTIONS,
    tools: [...geographyTools({ agency: "hud", catalog, include: ["resolve_place"] })],
    describeSource,
  };
}

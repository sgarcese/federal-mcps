/**
 * @federal-mcps/core — shared runtime for every server in the family.
 *
 * Sub-modules land by issue: envelope (#4), http (#5), server (#6),
 * testing/contract (#7), geography (M2). This entry point re-exports them as
 * they arrive so servers import from one place.
 */

/** The package version, read at build time so servers can report it in `initialize`. */
export const CORE_VERSION = "0.0.0";

/**
 * The family's tool verbs (ADR-001 §2). A tool whose name ends in one of these
 * must accept that verb's documented parameters; the contract harness (#7)
 * enforces it.
 */
export const FAMILY_VERBS = [
  "resolve_place",
  "list_indicators",
  "get_indicator",
  "compare_places",
  "get_raw",
  "describe_source",
] as const;

export type FamilyVerb = (typeof FAMILY_VERBS)[number];

export { CACHE_MISS, type CacheInfo, CacheInfoSchema } from "./cache.js";
export * from "./envelope/index.js";
export * from "./http/index.js";

export * from "./server/definition.js";

/**
 * The provenance envelope every family tool returns (#4). See
 * docs/architecture.md "The shared core" and ADR-003 §6.
 */
export { type Envelope, type EnvelopeInput, envelope } from "./envelope.js";
export {
  EnvelopeSchema,
  envelopeSchema,
  FootnoteSchema,
  PlaceRefSchema,
  SourceSchema,
} from "./schema.js";
export {
  agencyDisplayName,
  buildCitation,
  FOOTNOTE_FLAGS,
  type Footnote,
  type FootnoteFlag,
  footnoteFlagsFromCode,
  type PlaceRef,
  type PlaceRefInput,
  placeRef,
  type Source,
} from "./types.js";

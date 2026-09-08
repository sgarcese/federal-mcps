/**
 * The provenance envelope every family tool returns (#4). See
 * docs/architecture.md "The shared core" and ADR-003 §6.
 */
export { envelope, type Envelope, type EnvelopeInput } from "./envelope.js";
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
  footnoteFlagsFromCode,
  type Footnote,
  type FootnoteFlag,
  placeRef,
  type PlaceRef,
  type PlaceRefInput,
  type Source,
} from "./types.js";

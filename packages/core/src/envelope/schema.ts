import { z } from "zod";
import { CacheInfoSchema } from "../cache.js";
import { FOOTNOTE_FLAGS } from "./types.js";

/** Zod mirror of `PlaceRef` (types.ts). Parents are shallow but typed recursively. */
export const PlaceRefSchema: z.ZodType<{
  geoid: string;
  ucgid: string;
  dcid: string;
  name: string;
  kind: { sumlevel: string; label: string };
  parents: Array<z.infer<typeof PlaceRefSchema>>;
  caveat?: string | undefined;
}> = z.lazy(() =>
  z.object({
    geoid: z.string(),
    ucgid: z.string(),
    dcid: z.string(),
    name: z.string(),
    kind: z.object({
      sumlevel: z.string(),
      label: z.string(),
    }),
    parents: z.array(PlaceRefSchema),
    caveat: z.string().optional(),
  }),
);

/** Zod mirror of `Source` (types.ts). */
export const SourceSchema = z.object({
  agency: z.string(),
  program: z.string(),
  dataset: z.string().optional(),
  ids: z.array(z.string()),
  url: z.string(),
  citation: z.string(),
});

/** Zod mirror of `Footnote` (types.ts). */
export const FootnoteSchema = z.object({
  code: z.string(),
  text: z.string(),
  flags: z.array(z.enum(FOOTNOTE_FLAGS)),
});

/** Zod mirror of `EnvelopeLimit` (types.ts): the refusal's `limit` block (ADR-020 §4). */
export const LimitBlockSchema = z.object({
  scope: z.enum(["network", "pool", "service"]),
  kind: z.enum(["upstream", "toolCalls"]),
  source: z.string().optional(),
  limit: z.number().int().nonnegative().optional(),
  used: z.number().int().nonnegative().optional(),
  resetsAt: z.iso.datetime({ offset: true }),
});

/**
 * Builds the Zod schema for `Envelope<T>` given a schema for `T`. Every field
 * beyond `data` is fixed by the family's provenance contract.
 */
export function envelopeSchema<DataSchema extends z.ZodTypeAny>(dataSchema: DataSchema) {
  return z.object({
    data: dataSchema,
    place: PlaceRefSchema.optional(),
    source: SourceSchema,
    retrievedAt: z.iso.datetime({ offset: true }),
    vintage: z.string().optional(),
    footnotes: z.array(FootnoteSchema),
    limitations: z.array(z.string()),
    cache: CacheInfoSchema,
    /** Present only on refusals (ADR-020 §4). */
    limit: LimitBlockSchema.optional(),
  });
}

/** A permissive envelope schema (`data: unknown`) for validating shape without knowing `T`. */
export const EnvelopeSchema = envelopeSchema(z.unknown());

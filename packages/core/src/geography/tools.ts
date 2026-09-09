import { z } from "zod";
import type { ToolDefinition, ToolHandlerResult } from "../server/definition.js";
import type { GeographyCatalog } from "./catalog.js";
import {
  getAvailability,
  getContainment,
  getLineage,
  getOverlap,
  resolvePlace,
} from "./resolver.js";
import type { PlaceCandidate } from "./types.js";

/** Which geography tools a server mounts. Agency servers take just `resolve_place`. */
export type GeographyToolName =
  | "resolve_place"
  | "get_containment"
  | "get_overlap"
  | "get_lineage"
  | "list_availability";

export interface GeographyToolsOptions {
  /** Agency prefix for the tool names ("bls" → `bls_resolve_place`, "geo" → `geo_…`). */
  agency: string;
  /** How the handler gets a read-only catalog. Called per invocation; cache upstream. */
  catalog: () => GeographyCatalog;
  /** Tools to include (default: just `resolve_place`, what an agency server needs). */
  include?: readonly GeographyToolName[];
}

const SOURCE = {
  agency: "census",
  program: "geography",
  ids: [] as string[],
  url: "https://www.census.gov/programs-surveys/geography.html",
  citation:
    "U.S. Census Bureau geographic reference files, OMB delineations, and BLS area codes (federal-mcps geography catalog).",
};

/**
 * The family's geography tools, built on the shared resolver (ADR-003 §8, ADR-008). A
 * server spreads these into its `tools` so its `*_resolve_place` comes from core, not a
 * hand-rolled lookup. Every tool carries `fromCore` so the contract harness allows the
 * `resolve_place` name.
 */
export function geographyTools(options: GeographyToolsOptions): ToolDefinition[] {
  const include = options.include ?? ["resolve_place"];
  const p = (verb: string): string => `${options.agency}_${verb}`;
  const tools: ToolDefinition[] = [];

  if (include.includes("resolve_place")) {
    const input = z.object({
      query: z.string().describe("A place name, e.g. 'Denver', 'Denver County', 'Cook County IL'."),
      kind: z
        .string()
        .optional()
        .describe(
          "Restrict to a kind: 'state', 'county', 'city', 'metro', 'zcta', or a summary level.",
        ),
      state: z.string().optional().describe("Restrict to a state: 2-letter USPS code or FIPS."),
    });
    tools.push({
      name: p("resolve_place"),
      fromCore: true,
      description:
        "Resolve a place name to candidates with every identifier (GEOID, UCGID, Data Commons DCID), its parents, which programs publish at its level, and structured flags. Returns status 'ambiguous' when a name means several kinds — pick one with `kind`.",
      input,
      examples: [{ title: "Denver, disambiguated", input: { query: "Denver", kind: "county" } }],
      handler: async (args): Promise<ToolHandlerResult> => {
        const { query, kind, state } = input.parse(args);
        const result = resolvePlace(options.catalog(), query, {
          ...(kind === undefined ? {} : { kind }),
          ...(state === undefined ? {} : { state }),
        });
        const top = result.candidates[0];
        return {
          data: result,
          source: SOURCE,
          ...(top ? { place: placeRefOf(top) } : {}),
          ...(result.status === "ambiguous" ? { limitations: [result.explanation] } : {}),
        };
      },
    });
  }

  if (include.includes("get_containment")) {
    tools.push(
      edgeTool(
        p("get_containment"),
        "a place's containment hierarchy (parents with allocation shares)",
        options,
        getContainment,
      ),
    );
  }
  if (include.includes("get_overlap")) {
    tools.push(
      edgeTool(
        p("get_overlap"),
        "a place's areal overlaps (e.g. a ZCTA's tracts with allocation shares)",
        options,
        getOverlap,
      ),
    );
  }
  if (include.includes("get_lineage")) {
    const input = z.object({ geoid: z.string().describe("A 2010 census tract GEOID.") });
    tools.push({
      name: p("get_lineage"),
      fromCore: true,
      description:
        "A census tract's successors across the 2010 → 2020 vintage change, with shares.",
      input,
      examples: [{ title: "tract lineage", input: { geoid: "25025010104" } }],
      handler: async (args): Promise<ToolHandlerResult> => ({
        data: { lineage: getLineage(options.catalog(), input.parse(args).geoid) },
        source: SOURCE,
      }),
    });
  }

  if (include.includes("list_availability")) {
    const input = z.object({ geoid: z.string().describe("A Census GEOID.") });
    tools.push({
      name: p("list_availability"),
      fromCore: true,
      description:
        "Which programs publish data for a place's summary level, and whether this exact place has a code (else data falls back, e.g. to its county).",
      input,
      examples: [{ title: "availability for Denver County", input: { geoid: "08031" } }],
      handler: async (args): Promise<ToolHandlerResult> => ({
        data: { availability: getAvailability(options.catalog(), input.parse(args).geoid) },
        source: SOURCE,
      }),
    });
  }

  return tools;
}

function edgeTool(
  name: string,
  what: string,
  options: GeographyToolsOptions,
  fn: (catalog: GeographyCatalog, geoid: string) => unknown,
): ToolDefinition {
  const input = z.object({ geoid: z.string().describe("A Census GEOID.") });
  return {
    name,
    fromCore: true,
    description: `Return ${what}.`,
    input,
    examples: [{ title: "by geoid", input: { geoid: "08031" } }],
    handler: async (args): Promise<ToolHandlerResult> => ({
      data: { edges: fn(options.catalog(), input.parse(args).geoid) },
      source: SOURCE,
    }),
  };
}

/** Maps a resolved candidate to the envelope's `place` block (ids travel with every result). */
function placeRefOf(c: PlaceCandidate) {
  return {
    geoid: c.geoid,
    ucgid: c.ucgid,
    dcid: c.dcid,
    name: c.name,
    kind: c.kind,
    parents: c.parents.map((pp) => ({
      geoid: pp.geoid,
      ucgid: `${pp.kind.sumlevel}0000US${pp.geoid}`,
      dcid: `geoId/${pp.geoid}`,
      name: pp.name,
      kind: pp.kind,
      parents: [],
    })),
    ...(c.caveat === undefined ? {} : { caveat: c.caveat }),
  };
}

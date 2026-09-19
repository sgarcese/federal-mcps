import type { ToolDefinition, ToolHandlerResult } from "@federal-mcps/core";
import { z } from "zod";
import { censusTableIndexCitation, CENSUS_DATA_JSON_URL } from "./describe-source.js";
import { searchTables, type TableIndexRow } from "./table-index.js";

/**
 * `census_search_tables` (ADR-014 §7, #175): finds ACS/decennial table ids by topic over the
 * vendored index (`table-index.ts`), so a model can hand `census_get_raw` a `get.group` without
 * guessing an id. No network call — the index is vendored and gunzipped in-process.
 */

const inputSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe("A topic, e.g. 'median household income', 'language spoken at home', or a table id."),
  endpoint: z
    .string()
    .optional()
    .describe("Restrict to one dataset path, e.g. 'acs/acs5', 'acs/acs5/subject', 'dec/pl'."),
  limit: z.number().int().min(1).max(50).default(20).describe("Maximum matches to return."),
});

interface SearchTablesData {
  readonly query: string;
  readonly matches: readonly TableIndexRow[];
}

export const searchTablesTool: ToolDefinition<typeof inputSchema, SearchTablesData> = {
  name: "census_search_tables",
  title: "Search tables",
  description:
    "Finds ACS and decennial table ids by topic (e.g. 'median household income', 'language " +
    "spoken at home') for use with census_get_raw. Searches a vendored index of table ids and " +
    "labels; ranks an exact or prefix id match first, then label topic matches. Not a live query.",
  input: inputSchema,
  examples: [{ title: "median household income", input: { query: "median household income" } }],
  handler: async (args): Promise<ToolHandlerResult<SearchTablesData>> => {
    const { query, endpoint, limit } = inputSchema.parse(args);
    const result = searchTables({
      query,
      limit,
      ...(endpoint === undefined ? {} : { endpoint }),
    });
    return {
      data: result,
      source: {
        agency: "census",
        program: "TABLES",
        ids: [],
        url: CENSUS_DATA_JSON_URL,
        citation: censusTableIndexCitation(),
      },
    };
  },
};

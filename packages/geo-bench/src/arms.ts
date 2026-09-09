import { createGeoServer } from "@federal-mcps/server-geo";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { BenchItem } from "./benchmark.js";
import type { Model, ToolSpec } from "./model.js";

export type Arm = "with_tools" | "without_tools";

export interface Answer {
  id: string;
  arm: Arm;
  question: string;
  text: string;
}

/**
 * Connect an MCP client to an in-process geography server (the same tools a host would
 * expose). The catalog comes from GEO_CATALOG_PATH — for a real gate run, the built
 * `@rc/geo-catalog`; tests inject a fixture via `setCatalogForTest` before calling this.
 */
export async function connectGeoClient(): Promise<Client> {
  const server = createGeoServer();
  const client = new Client({ name: "geo-bench", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** The geography tools, as the model-facing specs (name, description, input schema). */
export async function toolSpecs(client: Client): Promise<ToolSpec[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema,
  }));
}

/** The closed-book arm: the model answers each question with no tools. */
export async function runWithoutTools(
  items: readonly BenchItem[],
  model: Model,
): Promise<Answer[]> {
  const answers: Answer[] = [];
  for (const item of items) {
    const text = await model.answer(item.question, null, async () => "");
    answers.push({ id: item.id, arm: "without_tools", question: item.question, text });
  }
  return answers;
}

/** The tool arm: the model answers with the geography MCP tools available, via `client`. */
export async function runWithTools(
  items: readonly BenchItem[],
  model: Model,
  client: Client,
): Promise<Answer[]> {
  const specs = await toolSpecs(client);
  const exec = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const res = await client.callTool({ name, arguments: args });
    return JSON.stringify(res.structuredContent ?? res.content ?? {});
  };
  const answers: Answer[] = [];
  for (const item of items) {
    const text = await model.answer(item.question, specs, exec);
    answers.push({ id: item.id, arm: "with_tools", question: item.question, text });
  }
  return answers;
}

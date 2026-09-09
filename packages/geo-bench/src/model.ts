/**
 * The model under test, abstracted so the arms and their tests do not depend on any one
 * provider. A real run uses `AnthropicModel` (Haiku); tests use a scripted fake. The model
 * owns its own tool-use loop: given the tool specs and an executor, it decides when to call
 * a tool and returns a final text answer.
 */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** Runs one tool call (the arm wires this to the MCP client) and returns its text result. */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

export interface Model {
  readonly name: string;
  /** Answer `question`. `tools === null` is the closed-book arm; otherwise run a tool loop. */
  answer(question: string, tools: ToolSpec[] | null, exec: ToolExecutor): Promise<string>;
}

/**
 * The live model: Anthropic Haiku, running the standard tool-use loop. Kept dependency-lazy
 * (`import("@anthropic-ai/sdk")`) so the offline package and its tests never load the SDK or
 * need a key; only a real run does. Documented, not merge-gated (LIVE_TESTS-style).
 */
export interface AnthropicModelOptions {
  model?: string;
  apiKey?: string;
  maxToolTurns?: number;
}

export function anthropicModel(options: AnthropicModelOptions = {}): Model {
  const modelId = options.model ?? "claude-haiku-4-5-20251001";
  const maxToolTurns = options.maxToolTurns ?? 12;
  const name = `anthropic:${modelId}`;

  return {
    name,
    async answer(question, tools, exec) {
      // biome-ignore lint/suspicious/noExplicitAny: the SDK is loaded lazily and untyped here.
      const { default: Anthropic } = (await import("@anthropic-ai/sdk")) as any;
      const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
      const toolDefs = (tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
      // biome-ignore lint/suspicious/noExplicitAny: provider message shape.
      const messages: any[] = [{ role: "user", content: question }];

      for (let turn = 0; turn <= maxToolTurns; turn++) {
        const res = await client.messages.create({
          model: modelId,
          max_tokens: 1024,
          messages,
          ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
        });
        // biome-ignore lint/suspicious/noExplicitAny: provider content blocks.
        const toolUses = res.content.filter((b: any) => b.type === "tool_use");
        if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
          return (
            res.content
              // biome-ignore lint/suspicious/noExplicitAny: provider content blocks.
              .filter((b: any) => b.type === "text")
              // biome-ignore lint/suspicious/noExplicitAny: provider content blocks.
              .map((b: any) => b.text)
              .join("\n")
              .trim()
          );
        }
        messages.push({ role: "assistant", content: res.content });
        const results = await Promise.all(
          // biome-ignore lint/suspicious/noExplicitAny: provider content blocks.
          toolUses.map(async (u: any) => ({
            type: "tool_result" as const,
            tool_use_id: u.id,
            content: await exec(u.name, (u.input ?? {}) as Record<string, unknown>),
          })),
        );
        messages.push({ role: "user", content: results });
      }
      return "(gave up: exceeded the tool-use turn limit)";
    },
  };
}

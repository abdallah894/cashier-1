import { ProviderError, type ChatProvider, type NeutralMessage, type ProviderResult, type ToolDef } from "../types";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

type GroqMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
};

type GroqResponse = {
  choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
};

export function toGroqMessages(system: string, messages: NeutralMessage[]): GroqMessage[] {
  const out: GroqMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      });
    } else out.push({ role: "tool", tool_call_id: m.callId, name: m.name, content: m.content });
  }
  return out;
}

export function groqProvider(deps: { fetchImpl?: typeof fetch; apiKey?: () => string | undefined; model?: () => string } = {}): ChatProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiKey = deps.apiKey ?? (() => process.env.GROQ_API_KEY);
  const model = deps.model ?? (() => process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b");
  return {
    id: "groq",
    configured: () => Boolean(apiKey()),
    async complete({ system, messages, tools, signal }): Promise<ProviderResult> {
      const key = apiKey();
      if (!key) throw new ProviderError("auth", "GROQ_API_KEY is not set");
      let response: Response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model(),
            messages: toGroqMessages(system, messages),
            tools: tools.map(toGroqTool),
            tool_choice: "auto",
            parallel_tool_calls: false,
            temperature: 0.1,
            max_completion_tokens: 400,
          }),
          signal,
        });
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new ProviderError(timeout ? "timeout" : "unavailable", timeout ? "Groq timed out" : "could not reach Groq");
      }
      if (!response.ok) throw statusError("Groq", response.status);
      const json = (await response.json().catch(() => null)) as GroqResponse | null;
      const choice = json?.choices?.[0];
      const calls = (choice?.message?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) }));
      if (calls.length === 0 && choice?.finish_reason && choice.finish_reason !== "stop") {
        throw new ProviderError("bad_response", `Groq stopped early (${choice.finish_reason})`);
      }
      return { text: choice?.message?.content ?? null, toolCalls: calls };
    },
  };
}

function toGroqTool(tool: ToolDef) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** HTTP status -> provider error kind. The response body is never included (it can echo credentials). */
export function statusError(name: string, status: number): ProviderError {
  if (status === 429) return new ProviderError("quota", `${name} quota or rate limit reached`, status);
  if (status === 401 || status === 403) return new ProviderError("auth", `${name} rejected the API key`, status);
  if (status >= 500 || status === 408) return new ProviderError("unavailable", `${name} is unavailable (HTTP ${status})`, status);
  return new ProviderError("bad_response", `${name} refused the request (HTTP ${status})`, status);
}

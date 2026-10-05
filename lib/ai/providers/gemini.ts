import { ProviderError, type ChatProvider, type NeutralMessage, type ProviderResult, type ToolDef } from "../types";
import { statusError } from "./groq";

type Part = {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};
type Content = { role: "user" | "model" | "function"; parts: Part[] };
type GeminiResponse = { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[] };

export function toGeminiContents(messages: NeutralMessage[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", parts: [{ text: m.content }] });
    else if (m.role === "assistant") {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const call of m.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.args } });
      if (parts.length) out.push({ role: "model", parts });
    } else {
      let response: Record<string, unknown>;
      try {
        const parsed = JSON.parse(m.content) as unknown;
        response = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { result: parsed };
      } catch {
        response = { result: m.content };
      }
      out.push({ role: "function", parts: [{ functionResponse: { name: m.name, response } }] });
    }
  }
  return out;
}

export function geminiProvider(deps: { fetchImpl?: typeof fetch; apiKey?: () => string | undefined; models?: () => string[] } = {}): ChatProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiKey = deps.apiKey ?? (() => process.env.GEMINI_API_KEY);
  const models = deps.models ?? (() => (process.env.GEMINI_MODELS ?? "gemini-3.6-flash,gemini-3.8-flash").split(",").map((m) => m.trim()).filter(Boolean));
  return {
    id: "gemini",
    configured: () => Boolean(apiKey()),
    async complete({ system, messages, tools, signal }): Promise<ProviderResult> {
      const key = apiKey();
      if (!key) throw new ProviderError("auth", "GEMINI_API_KEY is not set");
      let lastError: ProviderError | null = null;
      // within one provider, a model that is gone or overloaded falls back to the next model
      for (const model of models()) {
        let response: Response;
        try {
          response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: toGeminiContents(messages),
              tools: [{ functionDeclarations: tools.map(toDeclaration) }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
            }),
            signal,
          });
        } catch (error) {
          const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
          lastError = new ProviderError(timeout ? "timeout" : "unavailable", timeout ? "Gemini timed out" : "could not reach Gemini");
          if (timeout) throw lastError;
          continue;
        }
        if (!response.ok) {
          const err = statusError("Gemini", response.status);
          if (err.kind === "unavailable" || response.status === 404) {
            lastError = err;
            continue; // try the next model
          }
          throw err;
        }
        const json = (await response.json().catch(() => null)) as GeminiResponse | null;
        const parts = json?.candidates?.[0]?.content?.parts ?? [];
        const calls = parts
          .filter((p) => p.functionCall)
          .map((p, i) => ({ id: `${p.functionCall!.name}-${i}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
        const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
        return { text: text || null, toolCalls: calls };
      }
      throw lastError ?? new ProviderError("unavailable", "no Gemini model is configured");
    },
  };
}

function toDeclaration(tool: ToolDef) {
  const hasProps = Object.keys((tool.parameters.properties as Record<string, unknown>) ?? {}).length > 0;
  return { name: tool.name, description: tool.description, ...(hasProps ? { parameters: tool.parameters } : {}) };
}

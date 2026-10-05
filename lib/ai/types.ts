/**
 * Provider-neutral shapes for the POS assistant. The assistant is ADVISORY:
 * it can read data through a fixed, read-only tool list and answer in text.
 * It has no tool that writes, sells, refunds, adjusts stock or touches
 * permissions, so it cannot change anything in the POS.
 */
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type NeutralMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string };

export type ToolDef = {
  name: string;
  description: string;
  /** JSON-schema `parameters` object */
  parameters: Record<string, unknown>;
};

export type ProviderErrorKind = "quota" | "auth" | "unavailable" | "timeout" | "bad_response";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type ProviderResult = { text: string | null; toolCalls: ToolCall[] };

export interface ChatProvider {
  readonly id: string;
  /** false when the API key is missing, so the provider is skipped, not failed */
  configured(): boolean;
  complete(input: {
    system: string;
    messages: NeutralMessage[];
    tools: ToolDef[];
    signal: AbortSignal;
  }): Promise<ProviderResult>;
}

export type AttemptLog = { provider: string; outcome: "ok" | "skipped_unconfigured" | "skipped_open_circuit" | ProviderErrorKind };

export type AssistantResult =
  | { ok: true; text: string; provider: string; degraded: boolean; attempts: AttemptLog[] }
  | {
      ok: false;
      code: "ai_unavailable" | "ai_quota" | "ai_misconfigured" | "ai_loop_limit";
      attempts: AttemptLog[];
      retryAfterSeconds?: number;
    };

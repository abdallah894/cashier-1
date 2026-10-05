import { ProviderHealth } from "./health";
import { MAX_TOOL_RESULT_CHARS, SYSTEM_PROMPT, TOOL_ARG_SCHEMAS, TOOL_DEFS } from "./tools";
import {
  ProviderError,
  type AssistantResult,
  type AttemptLog,
  type ChatProvider,
  type NeutralMessage,
  type ProviderErrorKind,
} from "./types";

export type ToolExecutors = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

export type HistoryTurn = { role: "user" | "assistant"; text: string };

export type AssistantInput = {
  providers: ChatProvider[];
  health: ProviderHealth;
  executors: ToolExecutors;
  history: HistoryTurn[];
  message: string;
  maxRounds?: number;
  timeoutMs?: number;
  /** telemetry hook: called once per provider failure (no secrets in `message`) */
  onProviderFailure?: (provider: string, kind: ProviderErrorKind, message: string) => void;
};

const MAX_TOOL_CALLS_PER_ROUND = 3;

/**
 * One assistant turn. Tries the configured providers in order, skipping any
 * whose circuit is open; a failure moves on to the next provider with the
 * conversation (including tool results already gathered) intact. If every
 * provider is unavailable the result says so clearly; the POS itself never
 * calls this code, so checkout is unaffected by any AI outage.
 */
export async function runAssistant(input: AssistantInput): Promise<AssistantResult> {
  const maxRounds = input.maxRounds ?? 4;
  const attempts: AttemptLog[] = [];
  const messages: NeutralMessage[] = [
    ...input.history.map((turn): NeutralMessage => (turn.role === "user" ? { role: "user", content: turn.text } : { role: "assistant", content: turn.text })),
    { role: "user", content: input.message },
  ];

  let firstChoice: string | null = null;
  let sawQuota = false;
  let sawAuth = false;
  let rounds = 0;

  for (const provider of input.providers) {
    if (firstChoice === null) firstChoice = provider.id;
    if (!provider.configured()) {
      attempts.push({ provider: provider.id, outcome: "skipped_unconfigured" });
      continue;
    }
    if (!input.health.allow(provider.id)) {
      attempts.push({ provider: provider.id, outcome: "skipped_open_circuit" });
      continue;
    }

    try {
      while (rounds < maxRounds) {
        rounds++;
        const result = await provider.complete({
          system: SYSTEM_PROMPT,
          messages,
          tools: TOOL_DEFS,
          signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
        });

        if (result.toolCalls.length === 0) {
          const text = (result.text ?? "").trim();
          if (!text) throw new ProviderError("bad_response", "the provider returned no answer");
          input.health.success(provider.id);
          attempts.push({ provider: provider.id, outcome: "ok" });
          return { ok: true, text: text.slice(0, 1500), provider: provider.id, degraded: provider.id !== firstChoice, attempts };
        }

        messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
        for (const call of result.toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND)) {
          messages.push({ role: "tool", callId: call.id, name: call.name, content: await runTool(input.executors, call.name, call.args) });
        }
        // calls beyond the cap are answered with an error so the transcript stays well-formed
        for (const call of result.toolCalls.slice(MAX_TOOL_CALLS_PER_ROUND)) {
          messages.push({ role: "tool", callId: call.id, name: call.name, content: JSON.stringify({ error: "too many tool calls in one step" }) });
        }
      }
      // the model kept asking for tools without answering: stop, this is not the provider's outage
      attempts.push({ provider: provider.id, outcome: "ok" });
      return { ok: false, code: "ai_loop_limit", attempts };
    } catch (error) {
      const kind: ProviderErrorKind = error instanceof ProviderError ? error.kind : "unavailable";
      input.health.failure(provider.id, kind);
      attempts.push({ provider: provider.id, outcome: kind });
      input.onProviderFailure?.(provider.id, kind, error instanceof Error ? error.message : "provider failed");
      if (kind === "quota") sawQuota = true;
      if (kind === "auth") sawAuth = true;
    }
  }

  const retry = Math.max(0, ...input.providers.map((p) => input.health.retryAfterSeconds(p.id)));
  const nothingConfigured = attempts.length > 0 && attempts.every((a) => a.outcome === "skipped_unconfigured");
  if (nothingConfigured || (sawAuth && !sawQuota && attempts.every((a) => a.outcome === "auth" || a.outcome === "skipped_unconfigured"))) {
    return { ok: false, code: "ai_misconfigured", attempts };
  }
  return { ok: false, code: sawQuota ? "ai_quota" : "ai_unavailable", attempts, retryAfterSeconds: retry || undefined };
}

/** Validates the model's arguments, runs the read-only tool, and returns a bounded JSON string. Never throws. */
async function runTool(executors: ToolExecutors, name: string, args: Record<string, unknown>): Promise<string> {
  const schema = TOOL_ARG_SCHEMAS[name];
  const executor = executors[name];
  if (!schema || !executor) return JSON.stringify({ error: `unknown tool: ${name.slice(0, 40)}` });
  const parsed = schema.safeParse(args);
  if (!parsed.success) return JSON.stringify({ error: "invalid arguments" });
  try {
    const out = JSON.stringify(await executor(parsed.data));
    return out.length > MAX_TOOL_RESULT_CHARS ? JSON.stringify({ truncated: true, partial: out.slice(0, MAX_TOOL_RESULT_CHARS - 60) }) : out;
  } catch {
    // do not leak database or stack details to the model (or the user)
    return JSON.stringify({ error: "tool failed" });
  }
}

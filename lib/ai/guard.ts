import { z } from "zod";
import type { HistoryTurn } from "./assistant";

/**
 * Request validation for the assistant route. The client may only send
 * plain user/assistant text turns: there is no way to inject a `system`
 * message or a tool result through the body, and size is bounded so one
 * request cannot burn the provider quota.
 */
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_HISTORY_TURNS = 12;
export const MAX_HISTORY_CHARS = 8000;

const turn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(1500),
});

export const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(turn).max(MAX_HISTORY_TURNS).default([]),
});

export type ParsedAssistantRequest = { message: string; history: HistoryTurn[] };

export type ParseResult =
  | { ok: true; value: ParsedAssistantRequest }
  | { ok: false; status: 400 | 413; error: "invalid_request" | "too_large" };

export function parseAssistantRequest(body: unknown): ParseResult {
  const parsed = assistantRequestSchema.safeParse(body);
  if (!parsed.success) {
    const tooBig = parsed.error.issues.some((i) => i.code === "too_big");
    return { ok: false, status: tooBig ? 413 : 400, error: tooBig ? "too_large" : "invalid_request" };
  }
  const total = parsed.data.history.reduce((sum, t) => sum + t.text.length, 0) + parsed.data.message.length;
  if (total > MAX_HISTORY_CHARS) return { ok: false, status: 413, error: "too_large" };
  return { ok: true, value: { message: parsed.data.message, history: parsed.data.history } };
}

/** Per-user budgets, enforced in the database so they hold across serverless instances. */
export const AI_LIMITS = [
  { scope: "ai", limit: 20, windowSeconds: 60 },
  { scope: "ai_day", limit: 400, windowSeconds: 86_400 },
] as const;

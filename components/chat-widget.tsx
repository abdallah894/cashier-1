"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; text: string };

type ApiError = { error?: string; retryAfterSeconds?: number | null };

/**
 * Advisory assistant. It can only read product, stock and sales information
 * and says nothing the POS has not told it; it is never part of checkout, so
 * an outage or a crash here must not affect selling. The error boundary
 * below keeps a rendering bug in this widget from taking the page down.
 */
export function ChatWidget() {
  return (
    <AssistantBoundary>
      <ChatPanel />
    </AssistantBoundary>
  );
}

class AssistantBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[assistant] widget crashed", error instanceof Error ? error.message : "unknown");
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function ChatPanel() {
  const t = useTranslations("assistant");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  function describe(status: number, body: ApiError): string {
    if (status === 401) return t("errors.signedOut");
    if (status === 403) return t("errors.forbidden");
    if (status === 413 || status === 400) return t("errors.tooLong");
    if (status === 429) return t("errors.rateLimited", { seconds: body.retryAfterSeconds ?? 60 });
    switch (body.error) {
      case "ai_quota":
        return t("errors.quota");
      case "ai_misconfigured":
        return t("errors.misconfigured");
      default:
        return t("errors.unavailable");
    }
  }

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", text: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: messages.slice(-10) }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiError & { received?: string };
      if (!res.ok || !data.received) {
        setError(describe(res.status, data));
        return;
      }
      setMessages([...nextMessages, { role: "assistant", text: data.received }]);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  return (
    <>
      {/* `end-4` instead of `right-4` so it sits in the correct corner in LTR and RTL. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t("close") : t("open")}
        className="fixed end-4 bottom-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg ring-1 ring-white/10 transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              d="M21 12c0 4.418-4.03 8-9 8-1.06 0-2.077-.16-3.02-.457L3 20l1.56-3.888C3.578 14.875 3 13.482 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("title")}
          className="fixed end-4 bottom-20 z-50 flex h-[28rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t("title")}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("advisory")}</p>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("hint")}</p>}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ms-auto bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="max-w-[85%] rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {t("thinking")}
              </div>
            )}
            {error && (
              <div role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={1000}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              className="max-h-24 flex-1 resize-none rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim()}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
            >
              {t("send")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

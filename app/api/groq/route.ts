import { NextRequest, NextResponse } from "next/server";

import { createPosTools } from "@/lib/gemini/pos-tools";
import { createClient } from "@/lib/supabase/server";

type History = { role: "user" | "model"; parts: Array<{ text?: string }> };
type ToolCall = { id: string; function: { name: string; arguments: string } };
type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};
type GroqResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; tool_calls?: ToolCall[] };
  }>;
};

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "qwen/qwen3.8-27b";
const MAX_TOOL_ROUNDS = 5;
const SYSTEM_PROMPT = `You are a POS assistant for store staff. Use tools for product, price, stock, and sales questions. Never invent data. Keep answers short and practical.`;

const tools = [
  {
    type: "function",
    function: {
      name: "lookupProduct",
      description: "Find an active product by name or barcode.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkStock",
      description: "Get stock for a product by name or barcode.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTodaysSales",
      description: "Summarize today's sales and top items.",
      parameters: { type: "object", properties: {} },
    },
  },
];

function safeFilter(query: string) {
  return query.replace(/[,()"\\]/g, " ").trim();
}

const functionMap: Record<string, (args: Record<string, unknown>) => Promise<unknown>> =
  createPosTools({
    async findActiveProducts(query) {
      const safe = safeFilter(query);
      if (!safe) return [];
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("products")
        .select("barcode, name_ar, name_en, price, stock_qty, low_stock_threshold, unit")
        .eq("active", true)
        .or(`name_ar.ilike.%${safe}%,name_en.ilike.%${safe}%,barcode.ilike.%${safe}%`)
        .limit(5);
      if (error) throw new Error(error.message);
      return (data ?? []).map((product) => ({
        barcode: product.barcode,
        nameAr: product.name_ar,
        nameEn: product.name_en,
        pricePiasters: Number(product.price),
        stockQty: Number(product.stock_qty),
        lowStockThreshold: Number(product.low_stock_threshold),
        unit: product.unit,
      }));
    },
    async getTodaySales() {
      const day = new Date().toISOString().slice(0, 10);
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("sales")
        .select("total, sale_items(name_ar, name_en, qty, line_total)")
        .gte("created_at", `${day}T00:00:00Z`)
        .lte("created_at", `${day}T23:59:59.999Z`);
      if (error) throw new Error(error.message);
      return (data ?? []).map((sale) => ({
        totalPiasters: Number(sale.total),
        items: (sale.sale_items ?? []).map((item) => ({
          nameAr: item.name_ar,
          nameEn: item.name_en,
          qty: Number(item.qty),
          lineTotalPiasters: Number(item.line_total),
        })),
      }));
    },
  });

async function callGroq(key: string, messages: Message[]) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      temperature: 0.1,
      max_completion_tokens: 300,
    }),
  });
  if (!response.ok) throw new Error(`${response.status}:${await response.text()}`);
  return (await response.json()) as GroqResponse;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = body?.message;
  const history: History[] = Array.isArray(body?.history) ? body.history : [];
  if (typeof message !== "string" || !message.trim())
    return NextResponse.json({ error: "Message must be a non-empty string" }, { status: 400 });
  const key = process.env.GROQ_API_KEY;
  if (!key)
    return NextResponse.json(
      { error: "Set GROQ_API_KEY in .env.local and restart Next.js" },
      { status: 503 }
    );

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(history.map((entry) => ({
      role: entry.role === "model" ? "assistant" : "user",
      content: entry.parts.map((part) => part.text ?? "").join(""),
    })) as Message[]),
    { role: "user", content: message.trim() },
  ];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await callGroq(key, messages);
      const choice = response.choices?.[0];
      const assistant = choice?.message;
      const calls = assistant?.tool_calls ?? [];
      if (calls.length === 0) {
        const text = assistant?.content?.trim();
        if (text && (!choice?.finish_reason || choice.finish_reason === "stop"))
          return NextResponse.json({ received: text });
        return NextResponse.json(
          { error: "Groq did not return a complete text answer." },
          { status: 502 }
        );
      }
      messages.push({ role: "assistant", content: assistant?.content ?? null, tool_calls: calls });
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
        const tool = functionMap[call.function.name];
        const result = tool ? await tool(args) : { error: `Unknown tool: ${call.function.name}` };
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        });
      }
    }
    return NextResponse.json({ error: "Assistant exceeded the tool-call limit." }, { status: 502 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    console.error("[groq] request failed:", error);
    if (detail.startsWith("429:"))
      return NextResponse.json(
        { error: "Groq free-tier limit reached. Please try again shortly." },
        { status: 429 }
      );
    if (detail.startsWith("401:") || detail.startsWith("403:"))
      return NextResponse.json(
        { error: "Groq access denied. Check GROQ_API_KEY." },
        { status: 502 }
      );
    return NextResponse.json(
      { error: "Could not reach Groq. Check your connection and server configuration." },
      { status: 502 }
    );
  }
}

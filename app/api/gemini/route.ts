import { NextRequest, NextResponse } from 'next/server'
import { createPosTools } from '@/lib/gemini/pos-tools'
import { createClient } from '@/lib/supabase/server'

// ---- Types ----------------------------------------------------------------

type Part = {
  text?: string
  thought?: boolean
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}

type Content = { role: 'user' | 'model' | 'function'; parts: Part[] }

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Part[] }
    finishReason?: string
  }>
}

const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.8-flash']
const MAX_FUNCTION_CALL_ROUNDS = 5

// fetch() does NOT throw on non-2xx responses like $fetch does in Nuxt.
// This class lets the rest of the logic keep checking `.statusCode` the same way.
class GeminiError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---- POS tools --------------------------------------------------------------
// Function declarations Gemini can choose to call. Keep names/args in sync
// with functionMap below.

const POS_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'lookupProduct',
        description: 'Look up an active product by name or barcode to get its EGP price, stock, and details',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Product name or barcode' },
          },
          required: ['query'],
        },
      },
      {
        name: 'getTodaysSales',
        description: "Get a summary of today's sales: total revenue, number of transactions, top items",
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'checkStock',
        description: 'Check current stock quantity for a product by name or barcode',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Product name or barcode' },
          },
          required: ['query'],
        },
      },
    ],
  },
]

// TODO: replace these with real calls into your DB/ORM. Keep the argument
// shapes matching the parameters declared above.
async function lookupProduct(args: Record<string, unknown>) {
  const query = String(args.query ?? '')
  // const product = await db.product.findFirst({ where: { OR: [{ name: { contains: query } }, { sku: query }] } })
  return { query, error: 'Not implemented — wire this up to your product lookup' }
}

async function getTodaysSales() {
  // const sales = await db.sale.findMany({ where: { date: today() } })
  return { error: 'Not implemented — wire this up to your sales data' }
}

async function checkStock(args: Record<string, unknown>) {
  const sku = String(args.sku ?? '')
  // const item = await db.inventory.findUnique({ where: { sku } })
  return { sku, error: 'Not implemented — wire this up to your inventory data' }
}

const legacyFunctionMap: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  lookupProduct,
  getTodaysSales,
  checkStock,
}

function escapeFilterValue(query: string) {
  return query.replace(/[,()"\\]/g, ' ').trim()
}

const functionMap: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = createPosTools({
  async findActiveProducts(query) {
    const safe = escapeFilterValue(query)
    if (!safe) return []
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('products')
      .select('barcode, name_ar, name_en, price, stock_qty, low_stock_threshold, unit')
      .eq('active', true)
      .or(`name_ar.ilike.%${safe}%,name_en.ilike.%${safe}%,barcode.ilike.%${safe}%`)
      .limit(5)
    if (error) throw new Error(`Product lookup failed: ${error.message}`)
    return (data ?? []).map((product) => ({
      barcode: product.barcode,
      nameAr: product.name_ar,
      nameEn: product.name_en,
      pricePiasters: Number(product.price),
      stockQty: Number(product.stock_qty),
      lowStockThreshold: Number(product.low_stock_threshold),
      unit: product.unit,
    }))
  },
  async getTodaySales() {
    const today = new Date().toISOString().slice(0, 10)
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('sales')
      .select('total, sale_items(name_ar, name_en, qty, line_total)')
      .gte('created_at', `${today}T00:00:00Z`)
      .lte('created_at', `${today}T23:59:59.999Z`)
    if (error) throw new Error(`Today's sales lookup failed: ${error.message}`)
    return (data ?? []).map((sale) => ({
      totalPiasters: Number(sale.total),
      items: (sale.sale_items ?? []).map((item) => ({
        nameAr: item.name_ar,
        nameEn: item.name_en,
        qty: Number(item.qty),
        lineTotalPiasters: Number(item.line_total),
      })),
    }))
  },
})

// ---- Gemini call with retry + model fallback -------------------------------

async function callGemini(
  model: string,
  apiKey: string,
  systemPrompt: string,
  contents: Content[]
): Promise<GeminiResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120_000)

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          tools: POS_TOOLS,
          generationConfig: { temperature: 0.1, topP: 0.9 },
        }),
        signal: controller.signal,
      }
    )

    if (!res.ok) {
      throw new GeminiError(res.status, `Gemini request failed with status ${res.status}`)
    }

    return (await res.json()) as GeminiResponse
  } finally {
    clearTimeout(timeoutId)
  }
}

// Runs callGemini with the same retry/fallback-model behavior as before,
// but operating on a `contents` array so it can be reused across the
// function-calling round trips below.
async function callGeminiWithFallback(
  apiKey: string,
  systemPrompt: string,
  contents: Content[]
): Promise<{ response?: GeminiResponse; lastError?: unknown }> {
  let aiResponse: GeminiResponse | undefined
  let lastError: unknown

  for (const model of FALLBACK_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        aiResponse = await callGemini(model, apiKey, systemPrompt, contents)
        lastError = undefined
        break
      } catch (error: unknown) {
        lastError = error
        const status = error instanceof GeminiError ? error.statusCode : 0

        if (status === 503) {
          await sleep(500 * (attempt + 1)) // brief backoff, then retry same model
          continue
        }
        break // non-503 error: no point retrying this model
      }
    }
    if (aiResponse) break // success, stop trying fallback models

    const status = lastError instanceof GeminiError ? lastError.statusCode : 0
    if (status !== 503) break // only fall through to next model on overload
  }

  return { response: aiResponse, lastError }
}

function errorResponse(lastError: unknown) {
  console.error('[gemini] request failed after retries/fallbacks:', lastError)
  const status = lastError instanceof GeminiError ? lastError.statusCode : 0

  if (status === 429) {
    return NextResponse.json(
      { error: 'Gemini quota exceeded. Check your free-tier limits and try later.' },
      { status: 429 }
    )
  }
  if (status === 401 || status === 403) {
    return NextResponse.json(
      { error: 'Gemini access denied. Check the server API key and project permissions.' },
      { status: 502 }
    )
  }
  if (status === 404) {
    return NextResponse.json(
      { error: 'Gemini model unavailable. Check the model names in FALLBACK_MODELS.' },
      { status: 502 }
    )
  }
  if (status === 503) {
    return NextResponse.json(
      { error: 'Gemini is temporarily overloaded on all configured models. Please try again shortly.' },
      { status: 503 }
    )
  }
  return NextResponse.json(
    { error: 'Could not reach Gemini. Check your connection and server configuration.' },
    { status: 502 }
  )
}

const SYSTEM_PROMPT = `You are a POS (point of sale) assistant for store staff.

Use the available tools (lookupProduct, getTodaysSales, checkStock) to answer
questions with real, current data — never guess or invent numbers, prices, or
stock levels. If a tool returns an error, tell the user plainly rather than
making up a plausible-sounding answer.

Keep answers short and practical — staff are using this mid-shift, not reading
a report. Use plain language, not code or markdown formatting.`

// ---- Route handler ----------------------------------------------------------

export async function POST(req: NextRequest) {
  const body = await req.json()
  const message = body?.message
  const history: Content[] = Array.isArray(body?.history) ? body.history : []

  if (typeof message !== 'string' || message.trim() === '') {
    return NextResponse.json({ error: 'Message must be a non-empty string' }, { status: 400 })
  }

  // No NUXT_-style prefix needed — just a plain server-side env var.
  // Never prefix this with NEXT_PUBLIC_, or it leaks into the client bundle.
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Set GEMINI_API_KEY in .env.local on the server and restart Next.js' },
      { status: 503 }
    )
  }

  const contents: Content[] = [...history, { role: 'user', parts: [{ text: message.trim() }] }]

  let candidate: NonNullable<GeminiResponse['candidates']>[number] | undefined

  for (let round = 0; round < MAX_FUNCTION_CALL_ROUNDS; round++) {
    const { response, lastError } = await callGeminiWithFallback(apiKey, SYSTEM_PROMPT, contents)

    if (!response) {
      return errorResponse(lastError)
    }

    candidate = response.candidates?.[0]
    const parts = candidate?.content?.parts ?? []
    const functionCalls = parts.filter((p) => p.functionCall)

    if (functionCalls.length === 0) {
      break // model gave a final text answer — stop looping
    }

    // Run every requested function call, then feed the results back in.
    contents.push({ role: 'model', parts })

    const functionResponseParts: Part[] = await Promise.all(
      functionCalls.map(async (part) => {
        const call = part.functionCall!
        const fn = functionMap[call.name]
        const result = fn ? await fn(call.args ?? {}) : { error: `Unknown function: ${call.name}` }
        return {
          functionResponse: { name: call.name, response: result as Record<string, unknown> },
        }
      })
    )

    contents.push({ role: 'user', parts: functionResponseParts })
  }

  const text =
    candidate?.content?.parts
      ?.filter((part) => !part.thought && !part.functionCall && typeof part.text === 'string')
      .map((part) => part.text)
      .join('') ?? ''
  const cleaned = text.trim()

  if (!cleaned || (candidate?.finishReason && candidate.finishReason !== 'STOP')) {
    return NextResponse.json(
      { error: 'Gemini did not return a complete text answer. Try rephrasing the question.' },
      { status: 502 }
    )
  }

  return NextResponse.json({ received: cleaned })
}
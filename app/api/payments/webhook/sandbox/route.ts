import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/observability/log";
import { limitByIp } from "@/lib/ops/rate-limit";
import { providerEventSchema, verifySignature, type ApplyResult } from "@/lib/payments/webhook";

// Sandbox provider callback. The only thing a callback can do is move the
// status of an EXISTING payment (apply_provider_event); it can never create
// a sale or a refund. Redeliveries are answered 200 "duplicate" so providers
// stop retrying.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const limited = await limitByIp(request, "webhook", 120, 60);
  if (limited) return limited;
  const secret = process.env.PAYMENT_SANDBOX_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });

  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get("x-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = providerEventSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid event" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_provider_event", {
    p_provider: "sandbox",
    p_event_id: parsed.data.eventId,
    p_provider_reference: parsed.data.reference,
    p_status: parsed.data.status,
    p_amount: parsed.data.amount,
  });
  if (error) {
    // unknown payment / amount mismatch: a client error the provider should look at, not retry blindly
    // The body carries a fixed code only: database error text must never leave the server.
    const code = error.message.includes("unknown payment") ? "unknown_payment" : error.message.includes("amount mismatch") ? "amount_mismatch" : null;
    log.warn("payment_webhook_rejected", { eventId: parsed.data.eventId, reason: error.message });
    return NextResponse.json({ error: code ?? "internal_error" }, { status: code ? 422 : 500 });
  }
  return NextResponse.json({ status: data as ApplyResult });
}

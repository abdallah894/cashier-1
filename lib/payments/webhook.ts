import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** The callback body a provider sends. Amounts are integer piasters. */
export const providerEventSchema = z.object({
  /** unique per provider event; the dedupe key */
  eventId: z.string().trim().min(1).max(120),
  /** the reference the payment was created with */
  reference: z.string().trim().min(4).max(40),
  status: z.enum(["authorized", "captured", "declined", "failed", "voided"]),
  amount: z.number().int().positive(),
});

export type ProviderEvent = z.infer<typeof providerEventSchema>;

/** Lower-case hex HMAC-SHA256 of the raw request body. */
export function signBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Constant-time check of the `x-signature` header against the raw body.
 * Verifying the raw bytes (not re-serialised JSON) is what makes the
 * signature meaningful; an empty secret never verifies.
 */
export function verifySignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = Buffer.from(signBody(rawBody, secret), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(signature.trim().toLowerCase(), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Outcome of applying an event, as returned by apply_provider_event. */
export type ApplyResult = "applied" | "duplicate" | "ignored";

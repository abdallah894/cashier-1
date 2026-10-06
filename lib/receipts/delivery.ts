import { formatPiasters } from "./escpos";
import type { ReceiptData } from "./types";

/**
 * Optional receipt delivery (email / SMS / gift). Printing is the supported
 * path. Email and SMS need a provider the business has not chosen yet, so the
 * delivery entry point answers "unsupported" instead of pretending to send.
 *
 * PRIVACY RULES (enforced by tests):
 *  - customer-facing text never contains the cashier's name, internal ids or
 *    any approval/PIN data (ReceiptData carries none, and the text builder
 *    only reads the fields it needs);
 *  - logs and UI show recipients masked, never in full;
 *  - a recipient is only used if the customer typed it for this receipt (or
 *    consented to receipts); nothing is looked up or guessed.
 */
export type ReceiptChannel = "email" | "sms";

export function maskEmail(email: string): string {
  const [local, domain] = email.trim().split("@");
  if (!local || !domain) return "***";
  return `${local[0]}${"*".repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${"*".repeat(Math.max(3, digits.length - 4))}${digits.slice(-4)}`;
}

/** Plain-text receipt for email/SMS bodies; prices in EGP, English item names, no staff or internal data. */
export function buildTextReceipt(receipt: ReceiptData, options: { gift?: boolean } = {}): string {
  const lines: string[] = [receipt.store.nameEn, ...(receipt.store.addressEn ? [receipt.store.addressEn] : []), ""];
  lines.push(options.gift ? "GIFT RECEIPT" : `Receipt ${receipt.provisionalLabel ?? `#${receipt.saleNumber}`}`);
  lines.push(receipt.createdAt.slice(0, 16).replace("T", " "), "");
  for (const line of receipt.lines) {
    lines.push(options.gift ? `${line.qty} x ${line.nameEn}` : `${line.qty} x ${line.nameEn}  ${formatPiasters(line.lineTotal)}`);
  }
  if (!options.gift) {
    lines.push("", `Total: EGP ${formatPiasters(receipt.total)}`);
    lines.push(`VAT included: EGP ${formatPiasters(receipt.taxTotal)}`);
  }
  lines.push("", "Thank you for shopping with us!");
  return lines.join("\n");
}

export type DeliveryResult = { status: "unsupported"; reason: string } | { status: "queued"; recipient: string };

/** Entry point for email/SMS delivery. No provider is configured in this release. */
export function deliverReceipt(channel: ReceiptChannel, recipient: string): DeliveryResult {
  void recipient;
  return {
    status: "unsupported",
    reason: `${channel} delivery needs a provider; see docs/hardware.md. Print the receipt or use the PDF download instead.`,
  };
}

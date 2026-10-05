/**
 * Supported payment providers. This list is the contract with the database
 * (payments.provider CHECK) and the UI.
 *
 *  - cash:            recorded by the sale itself; never started explicitly.
 *  - manual_terminal: the cashier charges a bank POS terminal and records its
 *                     approval code (RRN). The terminal keeps all card data,
 *                     so the POS stays outside card-data scope.
 *  - sandbox:         test double that exercises the callback path (HMAC
 *                     signed webhook -> apply_provider_event).
 *
 * A real gateway (Paymob, Fawry, Geidea, Nearpay, a bank's own API...) is
 * added by creating a provider with its own webhook route that translates the
 * gateway's events into `apply_provider_event` calls, plus a migration that
 * widens the payments.provider CHECK. The business must choose the gateway
 * first; see docs/payments.md.
 */
export const PAYMENT_PROVIDERS = ["cash", "manual_terminal", "sandbox"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export type ProviderInfo = {
  id: PaymentProviderId;
  /** the cashier must type a reference (approval code) to capture */
  requiresReference: boolean;
  /** receives signed callbacks */
  hasWebhook: boolean;
};

export const PROVIDER_INFO: Record<PaymentProviderId, ProviderInfo> = {
  cash: { id: "cash", requiresReference: false, hasWebhook: false },
  manual_terminal: { id: "manual_terminal", requiresReference: true, hasWebhook: false },
  sandbox: { id: "sandbox", requiresReference: true, hasWebhook: true },
};

/**
 * A terminal approval code / RRN: 4-40 letters, digits, dot, underscore or
 * dash. A 13-19 digit value looks like a card number and is rejected, so a
 * cashier can never put a PAN into the system by mistake. The same rule is
 * enforced in the database (valid_payment_reference).
 */
export function isValidPaymentReference(value: string): boolean {
  return /^[A-Za-z0-9._-]{4,40}$/.test(value) && !/^[0-9]{13,19}$/.test(value);
}

# Phase 5 — Auth, Roles & Shifts

Read CLAUDE.md. Phases 1–4 complete.

## Tasks

1. **Login:** Supabase Auth (email/password), middleware-protected routes, session handling with the server client. Redirect by role after login.
2. **Role enforcement:** admin sees everything; cashier sees register + own shift + own sales only. Enforced by **RLS** (verify by attempting forbidden queries as cashier) AND reflected in UI/navigation.
3. **Cashier switching:** fast-switch on the register — pick cashier, enter PIN (hashed in `profiles.pin_hash`), without full logout/login. Keep it secure server-side (verify PIN via RPC, never expose hashes).
4. **User management (admin):** create/deactivate cashiers, set PIN, assign role.
5. **Shifts:**
   - Open shift: cashier enters opening cash float. Sales require an open shift — block the register otherwise with a clear prompt.
   - Close shift: enter counted cash → **Z-report**: opening float, cash sales, card sales, expected cash (float + cash sales), counted, over/short, totals, sale count, duration. Printable (reuse the receipt/print seam).
   - Shift history for admin; cashiers see their own.
6. Attach `shift_id` to every sale (already in schema) and validate it in `create_sale`.

## Done when

- Cashier login cannot access products admin, reports, or other cashiers' shifts (test the API, not just the UI)
- Register blocks until a shift is open; closing produces a correct Z-report where expected cash = float + cash sales
- PIN switch swaps the active cashier in under 5 seconds

End with: summary, manual test steps, 2–3 React↔Vue notes (middleware vs Nuxt route middleware is a natural one).

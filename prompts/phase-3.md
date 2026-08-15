# Phase 3 — The Register (heart of the app)

Read CLAUDE.md. Phases 1–2 complete. Build the sale screen. Optimize for speed: a cashier should ring up 20 items in under a minute using only the scanner and keyboard.

## Layout

Two-pane landscape: left = cart (line items, totals footer), right = search/quick actions. Large touch targets, but every action keyboard-reachable.

## Tasks

1. **Cart store (Zustand):** items with product snapshot data, qty (decimal for kg), line discount; derived subtotal, per-rate VAT breakdown, sale discount, grand total. All money math in piasters. (Note the Pinia parallel.)
2. **USB scanner listener:** global keydown handler active on the register route — buffers rapid keystrokes (< ~50ms apart) ending with Enter, treats the buffer as a barcode, ignores normal typing and inputs where the user is deliberately typing. Scanning an existing cart item increments qty. Unknown barcode → clear toast + option to quick-create the product (admin only).
3. **Camera scan modal:** html5-qrcode or ZXing; EAN-13/EAN-8/Code 128/QR; works on laptop webcam and phone.
4. **Search:** debounced, matches name_ar, name_en, barcode; arrow-key navigation, Enter to add.
5. **Line editing:** qty stepper + direct input (decimal for kg items), per-line discount (% or fixed), remove. Whole-sale discount too.
6. **Checkout dialog:**
   - Cash: tendered amount input (quick buttons: exact, 50, 100, 200), change calculated live; block if tendered < total.
   - Card: recorded as card payment.
   - Confirm → call the `create_sale` RPC (single transaction), handle insufficient-stock error gracefully, clear cart, route to receipt view (placeholder until Phase 4).
7. **Keyboard flow:** e.g. `/` focuses search, `F2` opens checkout, `Esc` closes dialogs, arrows navigate cart. Document the shortcuts on-screen.
8. Fully localized, verified in RTL (cart alignment flips correctly).

## Done when

- A full sale works end-to-end with only the scanner + keyboard: scan 3 items (one twice), edit a qty, apply a discount, cash checkout with change, stock visibly decremented, movement logged
- Weighted item (tomatoes, 1.25 kg) prices correctly
- Insufficient stock rolls back cleanly with a clear message

End with: summary, manual test steps, 2–3 React↔Vue notes (Zustand vs Pinia, useEffect cleanup for the global listener vs onMounted/onUnmounted).

# Implement customers, promotions, loyalty, and gift value

## Goal

Support repeat retail customers while keeping checkout fast and privacy-aware.

## Build

Start with customer profiles, optional sale linkage, consent, and purchase history. Add rule-based promotions/codes and authorized manual discounts. Add loyalty and gift-card/store-credit ledgers only after accounting rules are defined.

## Preserve

Customer attachment remains optional. Discount effects must be snapshotted on sale items and fully audited.

## Acceptance

- Consent and access are explicit.
- Promotions have eligibility, stacking, expiry, and conflict rules.
- Gift value is an immutable balance ledger, never a mutable number.
- Add tests for privacy, discount math, and redemption limits.

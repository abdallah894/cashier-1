-- Own migration: a new enum value cannot be used in the transaction that adds it.
-- 'split' labels a sale paid with more than one tender (card + cash); the
-- individual tenders live in public.payments.
alter type public.payment_method add value if not exists 'split';

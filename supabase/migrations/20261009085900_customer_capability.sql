-- Own migration: a new enum value cannot be used in the transaction that adds it.
alter type public.capability add value if not exists 'customer.manage';

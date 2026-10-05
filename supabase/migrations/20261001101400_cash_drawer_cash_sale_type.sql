-- PostgreSQL makes a new enum value visible only after this migration commits.
alter type public.cash_drawer_event_type add value 'cash_sale';

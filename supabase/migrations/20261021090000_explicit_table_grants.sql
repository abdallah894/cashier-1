-- Explicit table privileges.
--
-- Until now no migration granted anything on the tables: the app relied on Supabase
-- automatically giving `authenticated` and `service_role` access to every new table in
-- `public`. Newer Supabase setups no longer do that, and on such a project the seed script
-- and the website's server code failed with "permission denied for table profiles". Row
-- Level Security still decides WHICH rows each signed-in user may touch; these grants only
-- let the roles reach the tables at all (a policy cannot help a role with no privilege).
--
-- authenticated + service_role: read and write (RLS gates authenticated; service_role is
--   only ever used by server code). No TRUNCATE/REFERENCES/TRIGGER: the ledgers must stay
--   append-only, and the immutability triggers do not cover TRUNCATE for every table.
-- anon: nothing. Every screen needs a signed-in user, and sign-in itself goes through
--   Supabase Auth, not these tables.
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Tables created by later migrations get the same treatment automatically.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

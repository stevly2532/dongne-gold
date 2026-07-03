-- Core tables created in schema.sql need explicit grants (reset drops them).
-- Run after bootstrap or: npm run db:apply-core-grants

grant select, insert, update, delete on table public.branches to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.purchases to authenticated;

grant all on table public.branches to service_role;
grant all on table public.profiles to service_role;
grant all on table public.purchases to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

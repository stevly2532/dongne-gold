-- as_ledgers: after-service (repair) ledger
-- Run in Supabase SQL Editor.
-- Requires public.branches for branch_id foreign key.

create table if not exists public.as_ledgers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  branch_id uuid references public.branches (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  customer_name text,
  customer_phone text,
  product_name text,
  repair_note text,
  cost_won numeric(16, 2),
  paid_note text,
  received_note text,
  shipped_note text
);

create index if not exists as_ledgers_owner_idx on public.as_ledgers (owner_id);
create index if not exists as_ledgers_branch_created_idx on public.as_ledgers (branch_id, created_at desc);

alter table public.as_ledgers enable row level security;

drop policy if exists "as_ledgers_select_own" on public.as_ledgers;
create policy "as_ledgers_select_own"
  on public.as_ledgers for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "as_ledgers_insert_own" on public.as_ledgers;
create policy "as_ledgers_insert_own"
  on public.as_ledgers for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "as_ledgers_update_own" on public.as_ledgers;
create policy "as_ledgers_update_own"
  on public.as_ledgers for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "as_ledgers_delete_own" on public.as_ledgers;
create policy "as_ledgers_delete_own"
  on public.as_ledgers for delete to authenticated
  using (owner_id = auth.uid());

grant select, insert, update, delete on table public.as_ledgers to authenticated;
grant all on table public.as_ledgers to service_role;

notify pgrst, 'reload schema';


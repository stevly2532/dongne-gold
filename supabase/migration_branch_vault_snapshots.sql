-- Open vault cash per branch and local calendar date (shared across devices).
-- Run once in Supabase SQL Editor.

create table if not exists public.branch_vault_snapshots (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  vault_date date not null,
  amount_won bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

create unique index if not exists branch_vault_snapshots_branch_date_uniq
  on public.branch_vault_snapshots (branch_id, vault_date);

alter table public.branch_vault_snapshots enable row level security;

drop policy if exists "branch_vault_select" on public.branch_vault_snapshots;
drop policy if exists "branch_vault_insert" on public.branch_vault_snapshots;
drop policy if exists "branch_vault_update" on public.branch_vault_snapshots;
drop policy if exists "branch_vault_delete" on public.branch_vault_snapshots;

create policy "branch_vault_select"
  on public.branch_vault_snapshots for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (p.role = 'staff' and p.branch_id = branch_vault_snapshots.branch_id)
      )
    )
  );

create policy "branch_vault_insert"
  on public.branch_vault_snapshots for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (
          p.role = 'staff'
          and p.branch_id is not null
          and p.branch_id = branch_vault_snapshots.branch_id
        )
      )
    )
  );

create policy "branch_vault_update"
  on public.branch_vault_snapshots for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (
          p.role = 'staff'
          and p.branch_id is not null
          and p.branch_id = branch_vault_snapshots.branch_id
        )
      )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (
          p.role = 'staff'
          and p.branch_id is not null
          and p.branch_id = branch_vault_snapshots.branch_id
        )
      )
    )
  );

create policy "branch_vault_delete"
  on public.branch_vault_snapshots for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
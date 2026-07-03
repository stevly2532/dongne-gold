-- 통상: 지점·일자별 종로 발송 기록 (하루 1건)
create table if not exists public.tongsang_daily_entries (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  entry_date date not null,
  pure_gold_g numeric,
  gold_18k_g numeric,
  gold_14k_g numeric,
  captured_pure_don numeric,
  captured_don_24k numeric,
  captured_don_18k numeric,
  captured_don_14k numeric,
  shipment_item_1 text,
  shipment_item_2 text,
  shipment_item_3 text,
  shipment_item_4 text,
  shipment_item_5 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint tongsang_daily_entries_branch_date_uniq unique (branch_id, entry_date)
);

create index if not exists tongsang_daily_entries_branch_date_idx
  on public.tongsang_daily_entries (branch_id, entry_date desc);

alter table public.tongsang_daily_entries enable row level security;

drop policy if exists "tongsang_daily_entries_select" on public.tongsang_daily_entries;
create policy "tongsang_daily_entries_select"
  on public.tongsang_daily_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or (p.role = 'staff' and p.branch_id = tongsang_daily_entries.branch_id)
        )
    )
  );

drop policy if exists "tongsang_daily_entries_insert" on public.tongsang_daily_entries;
create policy "tongsang_daily_entries_insert"
  on public.tongsang_daily_entries
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or (p.role = 'staff' and p.branch_id = tongsang_daily_entries.branch_id)
        )
    )
  );

drop policy if exists "tongsang_daily_entries_update" on public.tongsang_daily_entries;
create policy "tongsang_daily_entries_update"
  on public.tongsang_daily_entries
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or (p.role = 'staff' and p.branch_id = tongsang_daily_entries.branch_id)
        )
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or (p.role = 'staff' and p.branch_id = tongsang_daily_entries.branch_id)
        )
    )
  );

drop policy if exists "tongsang_daily_entries_delete" on public.tongsang_daily_entries;
create policy "tongsang_daily_entries_delete"
  on public.tongsang_daily_entries
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or (p.role = 'staff' and p.branch_id = tongsang_daily_entries.branch_id)
        )
    )
  );

grant select, insert, update, delete on table public.tongsang_daily_entries to authenticated;

notify pgrst, 'reload schema';

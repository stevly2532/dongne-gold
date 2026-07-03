-- 제품별 공임 단가 (매장·품목·제품코드별)
-- Run once in Supabase SQL Editor, then reload API schema.

create table if not exists public.product_labor_fees (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete cascade,
  kind text not null default 'gold',
  product_code text not null,
  product_name text,
  labor_fee_won bigint not null default 0,
  note text,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create unique index if not exists product_labor_fees_branch_kind_code_uniq
  on public.product_labor_fees (branch_id, kind, product_code);

create index if not exists product_labor_fees_branch_idx
  on public.product_labor_fees (branch_id, sort_order, product_code);

alter table public.product_labor_fees enable row level security;

drop policy if exists "product_labor_fees_select" on public.product_labor_fees;
drop policy if exists "product_labor_fees_insert" on public.product_labor_fees;
drop policy if exists "product_labor_fees_update" on public.product_labor_fees;
drop policy if exists "product_labor_fees_delete" on public.product_labor_fees;

create policy "product_labor_fees_select"
  on public.product_labor_fees for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (p.role = 'staff' and p.branch_id = product_labor_fees.branch_id)
      )
    )
  );

create policy "product_labor_fees_insert"
  on public.product_labor_fees for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (
          p.role = 'staff'
          and p.branch_id is not null
          and p.branch_id = product_labor_fees.branch_id
        )
      )
    )
  );

create policy "product_labor_fees_update"
  on public.product_labor_fees for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (
          p.role = 'staff'
          and p.branch_id is not null
          and p.branch_id = product_labor_fees.branch_id
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
          and p.branch_id = product_labor_fees.branch_id
        )
      )
    )
  );

create policy "product_labor_fees_delete"
  on public.product_labor_fees for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'admin'
        or (
          p.role = 'staff'
          and p.branch_id is not null
          and p.branch_id = product_labor_fees.branch_id
        )
      )
    )
  );

grant select, insert, update, delete on table public.product_labor_fees to authenticated;
grant all on table public.product_labor_fees to service_role;

notify pgrst, 'reload schema';

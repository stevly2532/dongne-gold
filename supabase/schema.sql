-- 금은방 매입 장부 — Supabase SQL 편집기에 붙여넣어 한 번 실행하세요.
-- 프로젝트: Dashboard → SQL Editor

create extension if not exists "pgcrypto";

-- 지점
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- 직원 프로필 (auth.users 와 1:1)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  branch_id uuid references public.branches (id),
  created_at timestamptz not null default now()
);

-- 매입
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete restrict,
  created_by uuid not null references auth.users (id),
  purchased_at timestamptz not null default now(),
  item_type text not null,
  weight_g numeric(14, 3),
  purity text,
  unit_price numeric(16, 2),
  total_amount numeric(16, 2) not null,
  payment_method text,
  note text,
  created_at timestamptz not null default now()
);

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.purchases enable row level security;

-- 가입 시 프로필 자동 생성: 첫 가입자는 관리자, 이후는 직원
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, branch_id)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    case when (select count(*)::int from public.profiles) = 0 then 'admin' else 'staff' end,
    null
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'admin' from public.profiles p where p.id = uid),
    false
  );
$$;

-- profiles
create policy "profiles_select_self"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "profiles_select_admin"
  on public.profiles for select to authenticated
  using (public.is_admin(auth.uid()));

create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_update_admin"
  on public.profiles for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- branches
create policy "branches_select"
  on public.branches for select to authenticated
  using (true);

create policy "branches_insert_admin"
  on public.branches for insert to authenticated
  with check (public.is_admin(auth.uid()));

create policy "branches_update_admin"
  on public.branches for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "branches_delete_admin"
  on public.branches for delete to authenticated
  using (public.is_admin(auth.uid()));

-- purchases: 조회
create policy "purchases_select_admin"
  on public.purchases for select to authenticated
  using (public.is_admin(auth.uid()));

create policy "purchases_select_staff_branch"
  on public.purchases for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'staff'
        and p.branch_id is not null
        and p.branch_id = purchases.branch_id
    )
  );

-- purchases: 등록
create policy "purchases_insert_admin"
  on public.purchases for insert to authenticated
  with check (
    public.is_admin(auth.uid())
    and created_by = auth.uid()
  );

create policy "purchases_insert_staff"
  on public.purchases for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'staff'
        and p.branch_id is not null
        and p.branch_id = branch_id
    )
  );

-- purchases: 수정·삭제 (관리자 또는 해당 지점 직원)
create policy "purchases_update_admin"
  on public.purchases for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "purchases_update_staff"
  on public.purchases for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'staff'
        and p.branch_id is not null
        and p.branch_id = purchases.branch_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'staff'
        and p.branch_id is not null
        and p.branch_id = branch_id
    )
    and created_by = purchases.created_by
  );

create policy "purchases_delete_admin"
  on public.purchases for delete to authenticated
  using (public.is_admin(auth.uid()));

create policy "purchases_delete_staff"
  on public.purchases for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'staff'
        and p.branch_id is not null
        and p.branch_id = purchases.branch_id
    )
    and created_by = auth.uid()
  );

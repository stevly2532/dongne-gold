-- 입고 안내 문자 발송 이력 (문구·시간·수신번호)
create table if not exists public.arrival_sms_log (
  id uuid primary key default gen_random_uuid(),
  source_scope text not null check (source_scope in ('inventory', 'as')),
  source_id uuid not null,
  phone_digits text not null,
  message_body text not null,
  sent_at timestamptz not null default now(),
  sent_by uuid references auth.users (id) on delete set null
);

create index if not exists arrival_sms_log_source_sent_idx
  on public.arrival_sms_log (source_scope, source_id, sent_at desc);

alter table public.arrival_sms_log enable row level security;

drop policy if exists "arrival_sms_log_select_authenticated" on public.arrival_sms_log;
create policy "arrival_sms_log_select_authenticated"
  on public.arrival_sms_log
  for select
  to authenticated
  using (true);

drop policy if exists "arrival_sms_log_insert_authenticated" on public.arrival_sms_log;
create policy "arrival_sms_log_insert_authenticated"
  on public.arrival_sms_log
  for insert
  to authenticated
  with check (sent_by = auth.uid());

notify pgrst, 'reload schema';

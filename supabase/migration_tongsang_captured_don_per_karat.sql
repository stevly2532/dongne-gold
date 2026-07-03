-- 함량별 잡힌돈수 (24K·18K·14K 각 행)
alter table public.tongsang_daily_entries
  add column if not exists captured_don_24k numeric,
  add column if not exists captured_don_18k numeric,
  add column if not exists captured_don_14k numeric;

-- 예전 단일 잡힌돈수 열이 있을 때만 24K로 이전
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tongsang_daily_entries'
      and column_name = 'captured_pure_don'
  ) then
    update public.tongsang_daily_entries
    set captured_don_24k = captured_pure_don
    where captured_don_24k is null
      and captured_pure_don is not null;
  end if;
end $$;

notify pgrst, 'reload schema';

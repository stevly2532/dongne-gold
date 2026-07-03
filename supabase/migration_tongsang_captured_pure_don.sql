-- 이미 tongsang_daily_entries 테이블이 있는 경우: 잡힌돈수 열 추가
alter table public.tongsang_daily_entries
  add column if not exists captured_pure_don numeric;

notify pgrst, 'reload schema';

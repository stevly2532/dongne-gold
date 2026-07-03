-- 공임 관리: created_at 컬럼 추가 (등록 시간 내림차순 정렬용)
-- Supabase SQL Editor 에서 1회 실행 후 API 스키마 reload.

alter table public.product_labor_fees
  add column if not exists created_at timestamptz;

-- 기존 행은 updated_at 값으로 백필 (updated_at 도 없으면 now())
update public.product_labor_fees
   set created_at = coalesce(created_at, updated_at, now())
 where created_at is null;

alter table public.product_labor_fees
  alter column created_at set not null,
  alter column created_at set default now();

-- 매장·회사별로 최신 등록순 조회를 빠르게 하기 위한 인덱스
create index if not exists product_labor_fees_branch_created_idx
  on public.product_labor_fees (branch_id, created_at desc);

notify pgrst, 'reload schema';
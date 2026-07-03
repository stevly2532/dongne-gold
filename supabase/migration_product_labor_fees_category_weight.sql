-- 제품별 공임 단가에 카테고리(반지/목걸이/팔찌/귀걸이/기타)와 중량(g) 추가
-- 회사별로 모델번호(product_code) 단위로 공임표를 관리하기 위함.
-- Run once in Supabase SQL Editor, then reload API schema.

alter table public.product_labor_fees
  add column if not exists category text not null default '',
  add column if not exists weight_g numeric;

create index if not exists product_labor_fees_branch_vendor_category_idx
  on public.product_labor_fees (branch_id, vendor, category, product_code);

notify pgrst, 'reload schema';
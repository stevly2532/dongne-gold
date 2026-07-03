-- 제품별 공임 단가에 회사(vendor) 구분 추가
-- 같은 제품코드라도 회사가 다르면 별도 행으로 관리한다.
-- Run once in Supabase SQL Editor, then reload API schema.

alter table public.product_labor_fees
  add column if not exists vendor text not null default '';

-- 기존 (branch_id, kind, product_code) 유니크 제약을 회사 포함으로 교체
drop index if exists product_labor_fees_branch_kind_code_uniq;

create unique index if not exists product_labor_fees_branch_vendor_kind_code_uniq
  on public.product_labor_fees (branch_id, vendor, kind, product_code);

create index if not exists product_labor_fees_branch_vendor_idx
  on public.product_labor_fees (branch_id, vendor, sort_order, product_code);

notify pgrst, 'reload schema';
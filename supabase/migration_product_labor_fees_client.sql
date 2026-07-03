-- 제품별 공임에 거래처(회사 이름) 자유 입력 컬럼 추가
-- vendor(회사 탭)와 별개로, 제품을 받아오는 거래처 이름을 행마다 기재한다.
-- Run once in Supabase SQL Editor, then reload API schema.

alter table public.product_labor_fees
  add column if not exists client_name text;

notify pgrst, 'reload schema';

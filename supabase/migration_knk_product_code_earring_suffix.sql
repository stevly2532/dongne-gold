-- 케이앤케이 합금 공임: 기존 제품명(product_code) 뒤에 ' 귀걸이' 일괄 추가
-- 이미 귀걸이로 끝나는 행은 건너뜀. 신규 등록 로직은 변경하지 않음.

update public.product_labor_fees
set
  product_code = trim(product_code) || ' 귀걸이',
  updated_at = now()
where vendor = '케이앤케이'
  and trim(coalesce(product_code, '')) <> ''
  and trim(product_code) !~ '귀걸이$';

notify pgrst, 'reload schema';

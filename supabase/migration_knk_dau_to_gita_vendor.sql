-- 케이앤케이에 잘못 들어간 거래처 다우 제품 → 기타(vendor)로 이동
-- client_name 에 '다우' 포함(다우·다우사 등). 제품명·거래처·공임은 유지.

update public.product_labor_fees
set
  vendor = '기타',
  updated_at = now()
where vendor = '케이앤케이'
  and trim(coalesce(client_name, '')) <> ''
  and lower(trim(client_name)) like '%다우%';

notify pgrst, 'reload schema';

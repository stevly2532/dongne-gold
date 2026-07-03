-- 매출(inventory_items) 선금(원). 매출내역 표시·등록용 (다음 단계에서 입력 UI 연동)
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS deposit_won numeric;

COMMENT ON COLUMN inventory_items.deposit_won IS '선금(원). 없으면 NULL 또는 0.';

-- 일일 마감 시재 확인: 장부 외 현금 조정(수리 입금·이벤트 출금 등)
ALTER TABLE branch_daily_closings
  ADD COLUMN IF NOT EXISTS vault_misc_adjustment_won integer NOT NULL DEFAULT 0;

ALTER TABLE branch_daily_closings
  ADD COLUMN IF NOT EXISTS vault_misc_note text;

ALTER TABLE branch_daily_closings
  ADD COLUMN IF NOT EXISTS vault_misc_items jsonb NOT NULL DEFAULT '[]'::jsonb;

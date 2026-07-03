-- arrival_sms_sent_at: 입고 안내 문자를 발송한 시각. null이면 미발송(문자 버튼 색으로 구분).
alter table public.inventory_items add column if not exists arrival_sms_sent_at timestamptz;
alter table public.as_ledgers add column if not exists arrival_sms_sent_at timestamptz;
notify pgrst, 'reload schema';

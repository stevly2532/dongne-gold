export type Profile = {
  id: string;
  full_name: string | null;
  role: "admin" | "staff";
  branch_id: string | null;
  /** auth.users.email 과 트리거로 동기화되는 이메일. 직원 표시·식별용. */
  email?: string | null;
};

export type Branch = {
  id: string;
  name: string;
  created_at: string;
};

/** 금 장부(매입장부·매입등록 등): `gold`, 은 장부: `silver`, 치금 정산용: `chigum`, 매출장부 전용 금 시세: `gold_sales` */
export const JONGRO_QUOTE_SCOPE_GOLD = "gold" as const;
export const JONGRO_QUOTE_SCOPE_SILVER = "silver" as const;
export const JONGRO_QUOTE_SCOPE_CHIGUM = "chigum" as const;
/** 매출장부「금 매입시세」카드 전용 — 매입장부 `gold`와 별도 행으로 저장 */
export const JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER = "gold_sales" as const;

/** 지점별 일자 처리시세(원/돈). (branch_id, quote_date, quote_scope) 유니크. */
export type ProcessingDailyQuote = {
  id: string;
  branch_id: string;
  quote_date: string;
  price_per_don: number;
  updated_at: string;
  quote_scope?: string | null;
};

/** 오늘의 매입/매출 시세(원/돈) — 전 매장 공통. (quote_date, quote_scope) 유니크. */
export const DAILY_PURCHASE_PRICE_SCOPE_GOLD = "gold" as const;
export const DAILY_PURCHASE_PRICE_SCOPE_SILVER = "silver" as const;
/** 매출등록(inventory) 페이지 "오늘의 매출 시세 금" — 매입 `gold`와 분리. */
export const DAILY_PURCHASE_PRICE_SCOPE_SALES_GOLD = "sales_gold" as const;
export type DailyPurchasePriceScope =
  | typeof DAILY_PURCHASE_PRICE_SCOPE_GOLD
  | typeof DAILY_PURCHASE_PRICE_SCOPE_SILVER
  | typeof DAILY_PURCHASE_PRICE_SCOPE_SALES_GOLD;
export type DailyPurchasePrice = {
  id: string;
  quote_date: string;
  quote_scope: DailyPurchasePriceScope;
  price_per_don: number;
  updated_at: string;
  updated_by: string | null;
};

export type InventoryItem = {
  id: string;
  owner_id: string;
  branch_id?: string | null;
  sold_at?: string;
  /** 제품코드 (판매등록 UI) */
  name: string;
  /** 직접 입력 제품명 */
  product_name?: string | null;
  kind: string;
  quantity: number;
  unit: string;
  cost_price: number | null;
  sell_price: number | null;
  labor_fee?: number | null;
  weight_g?: number | null;
  purity?: string | null;
  payment_method?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  received?: boolean;
  shipped?: boolean;
  /** 입고 수기 (표에서 입력) */
  received_note?: string | null;
  /** 출고 수기 (표에서 입력) */
  shipped_note?: string | null;
  vendor_name?: string | null;
  order_ref?: string | null;
  size?: string | null;
  note: string | null;
  /** 매출 진행: 즉시출고(매장) | 접수 | 입금완료 | 발주 | 입고 | 출고완료 */
  fulfillment_status?: string | null;
  /** 선금(원). 없으면 null 또는 0. */
  deposit_won?: number | null;
  /** 미수금(원). 완불이면 null 또는 0. */
  receivable_won?: number | null;
  /** 종로 시세(원/돈) 직접 입력(override). 주로 은 매출에서 사용. */
  jongro_quote_override_per_don?: number | null;
  /** 등록 당시 오늘의 매출시세(원/돈·24K). 금·14K·18K 매출에 저장. */
  sales_gold_price_per_don?: number | null;
  /** 입고 안내 문자를 발송한 시각(ISO). null이면 미발송 — 문자 버튼 색으로 표시. */
  arrival_sms_sent_at?: string | null;
  updated_at: string;
};

export type Purchase = {
  id: string;
  branch_id: string;
  created_by: string;
  purchased_at: string;
  item_type: string;
  weight_g: number | null;
  purity: string | null;
  unit_price: number | null;
  total_amount: number;
  payment_method: string | null;
  note: string | null;
  created_at: string;
  gold_price_per_don?: number | null;
  karat?: string | null;
  purity_factor?: number | null;
  weight_don_raw?: number | null;
  pure_gold_g?: number | null;
  pure_gold_don?: number | null;
  fee_tier?: string | null;
  seller_name?: string | null;
  seller_phone?: string | null;
  processing_price_per_don?: number | null;
  margin_amount?: number | null;
  branches?: { name: string } | null;
};

export type ArrivalSmsLog = {
  id: string;
  source_scope: "inventory" | "as";
  source_id: string;
  phone_digits: string;
  message_body: string;
  sent_at: string;
  sent_by: string | null;
};

export type AsLedgerRow = {
  id: string;
  owner_id: string;
  branch_id: string | null;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  product_name: string | null;
  repair_note: string | null;
  cost_won: number | null;
  paid_note: string | null;
  received_note: string | null;
  shipped_note: string | null;
  /** 입고 안내 문자를 발송한 시각(ISO). null이면 미발송 — 문자 버튼 색으로 표시. */
  arrival_sms_sent_at?: string | null;
};

/**
 * 매장·회사·품목·카테고리·모델번호(product_code)별 공임 단가(원).
 * vendor/category는 ""(미지정)일 수 있다.
 * - category: 반지/목걸이/팔찌/귀걸이/기타 등 (디스플레이 그룹)
 * - weight_g: 모델별 중량(그램, null 가능)
 */
export type ProductLaborFee = {
  id: string;
  branch_id: string;
  vendor: string;
  kind: string;
  category: string;
  product_code: string;
  product_name: string | null;
  /** 거래처(회사 이름) — vendor 탭과 별개의 자유 입력 항목 */
  client_name?: string | null;
  labor_fee_won: number;
  weight_g: number | null;
  note: string | null;
  sort_order: number;
  /** Supabase Storage(`labor-fee-images` 버킷) 내 사진 경로. null이면 미등록 */
  image_path?: string | null;
  /** 최초 등록 시각. 마이그레이션 전 행은 updated_at 으로 백필됨 */
  created_at?: string | null;
  updated_at: string;
  updated_by: string | null;
};

/** 지점·한국일 기준 일일 마감 장부 스냅샷 */
export type BranchDailyClosing = {
  id: string;
  branch_id: string;
  closing_date: string;
  closed_at: string;
  closed_by: string;
  note: string | null;
  open_vault_won: number | null;
  today_cash_purchase_sum_won: number;
  counter_won_estimated: number | null;
  /** 시재 확인 — 장부 외 현금 조정(원, 음수=출금) 합계 */
  vault_misc_adjustment_won?: number;
  vault_misc_note?: string | null;
  /** 시재 확인 — 장부 외 현금 조정 건별 내역 */
  vault_misc_items?: VaultMiscItem[];
  purchase_count_gold: number;
  purchase_count_silver: number;
  purchase_count_chigum: number;
  purchase_count_other: number;
  weight_g_gold: number;
  weight_g_silver: number;
  weight_g_chigum: number;
  amount_won_gold: number;
  amount_won_silver: number;
  amount_won_chigum: number;
  amount_won_other: number;
  amount_won_total: number;
  checklist_vault_ack: boolean;
  checklist_purchase_ack: boolean;
};

/** 일일 마감 시재 — 기타 현금 조정 1건 */
export type VaultMiscItem = {
  amount_won: number;
  note: string | null;
};

/** 통상: 지점·일자별 종로 발송 기록 (하루 1건) */
export type TongsangDailyEntry = {
  id: string;
  branch_id: string;
  entry_date: string;
  pure_gold_g: number | null;
  gold_18k_g: number | null;
  gold_14k_g: number | null;
  shipment_item_1: string | null;
  shipment_item_2: string | null;
  shipment_item_3: string | null;
  shipment_item_4: string | null;
  shipment_item_5: string | null;
  /** @deprecated captured_don_24k 로 이전. 구 데이터 호환용 */
  captured_pure_don: number | null;
  captured_don_24k: number | null;
  captured_don_18k: number | null;
  captured_don_14k: number | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};
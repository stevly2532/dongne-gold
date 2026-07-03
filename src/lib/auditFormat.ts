import { formatDateTime, formatKRW } from "./format";
import { formatMobileInputDisplay } from "./koreanPhone";

const FIELD_LABELS: Record<string, string> = {
  branch_id: "매장",
  sold_at: "판매 일시",
  name: "제품코드",
  product_name: "제품명",
  kind: "품목",
  quantity: "수량",
  unit: "단위",
  labor_fee: "공임",
  weight_g: "중량(g)",
  purity: "함량",
  sell_price: "판매가",
  payment_method: "결제",
  receivable_won: "미수금",
  received: "입고",
  shipped: "출고",
  fulfillment_status: "발주 상태",
  customer_name: "고객 이름",
  customer_phone: "고객 전화",
  vendor_name: "거래처",
  order_ref: "주문번호",
  size: "사이즈",
  note: "비고",
  seller_name: "이름",
  seller_phone: "전화번호",
  purchased_at: "매입 일시",
  total_amount: "매입 금액",
  karat: "함량",
  fee_tier: "매입비 등급",
  gold_price_per_don: "처리시세(원/돈)",
  processing_price_per_don: "처리원가(원/돈)",
  margin_amount: "마진",
  unit_price: "매입시세(원/돈)",
  weight_don_raw: "돈수",
  purity_factor: "순도 계수",
  pure_gold_don: "순금 돈수",
};

const KIND_LABELS: Record<string, string> = {
  gold: "24K",
  gold_14k: "14K",
  gold_18k: "18K",
  silver: "은",
  other: "기타",
};

const FEE_TIER_LABELS: Record<string, string> = {
  none: "없음",
  a: "a",
  b: "b",
  c: "c",
};

const MONEY_KEYS = new Set([
  "sell_price",
  "labor_fee",
  "receivable_won",
  "total_amount",
  "gold_price_per_don",
  "processing_price_per_don",
  "margin_amount",
  "unit_price",
]);

const DATETIME_KEYS = new Set(["sold_at", "purchased_at"]);
const BOOLEAN_KEYS = new Set(["received", "shipped"]);
const PHONE_KEYS = new Set(["customer_phone", "seller_phone"]);

export function labelForAuditField(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

export function formatAuditValue(
  key: string,
  raw: string | null,
  branchLabels?: Map<string, string>,
): string {
  if (raw === null || raw === "") return "(없음)";

  if (DATETIME_KEYS.has(key)) {
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) return formatDateTime(raw);
  }

  if (MONEY_KEYS.has(key)) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      if (key === "receivable_won" && n === 0) return "완불";
      return formatKRW(n);
    }
  }

  if (BOOLEAN_KEYS.has(key)) {
    if (raw === "true") return "완료";
    if (raw === "false") return "미완료";
  }

  if (key === "weight_g") {
    const n = Number(raw);
    if (Number.isFinite(n)) return `${n} g`;
  }

  if (key === "quantity") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n.toLocaleString("ko-KR");
  }

  if (key === "kind") {
    return KIND_LABELS[raw] ?? raw;
  }

  if (key === "fee_tier") {
    return FEE_TIER_LABELS[raw] ?? raw;
  }

  if (PHONE_KEYS.has(key)) {
    return formatMobileInputDisplay(raw) || raw;
  }

  if (key === "branch_id" && branchLabels) {
    return branchLabels.get(raw) ?? raw;
  }

  return raw;
}
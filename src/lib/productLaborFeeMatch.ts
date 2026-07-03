/**
 * 공임관리(product_labor_fees) ↔ 매출 제품명 매칭.
 * "1돈 엥게이지 반지" 와 "엥게이지반지" 는 동일 제품으로 본다 (앞 돈수·공백만 정규화, 이름은 정확히 일치).
 */

import { GRAMS_PER_DON } from "@/lib/goldPurchase";

/** 매출장부·판매등록에서 업체명이 '매입'이면 공임 없음(칸에 매입 표시) */
export function isPurchaseVendorName(v: unknown): boolean {
  return String(v ?? "").trim() === "매입";
}

/** 앞쪽 "1돈"·"2.5돈" 등 중량 표기 제거 후 공백·대소문자 무시 */
export function normalizeProductKeyForLaborMatch(s: unknown): string {
  let t = String(s ?? "").trim().toLowerCase();
  t = t.replace(/\s+/g, "");
  t = t.replace(/^[\d]+(?:[.,]\d+)?돈/, "");
  return t;
}

export type ProductLaborFeeLookupRow = {
  product_code: string;
  labor_fee_won: number;
  weight_g?: number | null;
};

/** product_code 앞 "1돈" 등 돈수 표기 */
function donFromProductCodePrefix(code: string): number | null {
  const t = code.trim().toLowerCase().replace(/\s+/g, "");
  const m = t.match(/^([\d]+(?:[.,]\d+)?)돈/);
  if (!m) return null;
  const don = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(don) ? don : null;
}

/**
 * 공임관리 행 목록에서 매출 재고 행에 맞는 공임(원)을 찾는다.
 * 동일 제품명이 여러 행이면 중량(g)·product_code 돈수 표기로 우선 매칭한다.
 */
export function lookupLaborFeeWonForInventoryItem(
  rows: ReadonlyArray<ProductLaborFeeLookupRow>,
  item: {
    name?: string | null;
    product_name?: string | null;
    weight_g?: number | null;
  },
): number | null {
  const keys = new Set<string>();
  for (const label of [item.product_name, item.name]) {
    const k = normalizeProductKeyForLaborMatch(label);
    if (k) keys.add(k);
  }
  if (keys.size === 0) return null;

  const candidates = rows.filter((r) => {
    const k = normalizeProductKeyForLaborMatch(r.product_code);
    return k && keys.has(k);
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const fee = Number(candidates[0].labor_fee_won);
    return Number.isFinite(fee) ? Math.round(fee) : null;
  }

  const saleW =
    item.weight_g != null && Number.isFinite(Number(item.weight_g))
      ? Number(item.weight_g)
      : null;

  if (saleW != null) {
    const withWeight = candidates.filter(
      (r) => r.weight_g != null && Number.isFinite(Number(r.weight_g)),
    );
    const exact = withWeight.find(
      (r) => Math.abs(Number(r.weight_g) - saleW) < 0.01,
    );
    if (exact) {
      const fee = Number(exact.labor_fee_won);
      return Number.isFinite(fee) ? Math.round(fee) : null;
    }

    const saleDon = saleW / GRAMS_PER_DON;
    for (const r of candidates) {
      const donFromCode = donFromProductCodePrefix(String(r.product_code ?? ""));
      if (
        donFromCode != null &&
        Number.isFinite(saleDon) &&
        Math.abs(donFromCode - saleDon) < 0.05
      ) {
        const fee = Number(r.labor_fee_won);
        return Number.isFinite(fee) ? Math.round(fee) : null;
      }
    }
  }

  const generic = candidates.find((r) => {
    if (r.weight_g != null && Number.isFinite(Number(r.weight_g))) return false;
    return donFromProductCodePrefix(String(r.product_code ?? "")) == null;
  });
  if (generic) {
    const fee = Number(generic.labor_fee_won);
    return Number.isFinite(fee) ? Math.round(fee) : null;
  }

  const fee = Number(candidates[0].labor_fee_won);
  return Number.isFinite(fee) ? Math.round(fee) : null;
}

export function lookupLaborFeeWonByProductLabel(
  map: ReadonlyMap<string, number>,
  ...labels: Array<string | null | undefined>
): number | null {
  for (const label of labels) {
    const key = normalizeProductKeyForLaborMatch(label);
    if (!key) continue;
    const fee = map.get(key);
    if (fee != null && Number.isFinite(fee)) return fee;
  }
  return null;
}

export function buildLaborFeeByProductMap(
  rows: ReadonlyArray<{ product_code: string; labor_fee_won: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeProductKeyForLaborMatch(row.product_code);
    const fee = Number(row.labor_fee_won);
    if (!key || !Number.isFinite(fee)) continue;
    if (!map.has(key)) map.set(key, Math.round(fee));
  }
  return map;
}

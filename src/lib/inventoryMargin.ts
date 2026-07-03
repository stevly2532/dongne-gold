import { roundWon } from "@/lib/goldPurchase";
import { processingCostWonFromQuote } from "@/lib/purchaseMargin";
import {
  calculateSilverPurchase,
  defaultSilverPurity,
} from "@/lib/silverPurchase";
import type { InventoryItem, Purchase } from "@/types/db";

function purchaseLikeFromInventory(row: InventoryItem): Purchase {
  const karat =
    row.kind === "gold_18k" || row.purity === "18K"
      ? "18K"
      : row.kind === "gold_14k" || row.purity === "14K"
        ? "14K"
        : "24K";
  const sold = row.sold_at ?? row.updated_at;
  return {
    id: row.id,
    branch_id: row.branch_id ?? "",
    created_by: row.owner_id,
    purchased_at: sold,
    item_type: "\uAE08",
    weight_g: row.weight_g ?? null,
    purity: karat,
    unit_price: null,
    total_amount: 0,
    payment_method: null,
    note: null,
    created_at: row.updated_at,
    karat,
  };
}

export function inventorySaleMetalCostWon(
  processingGoldPerDon: number | null,
  processingSilverPerDon: number | null,
  row: InventoryItem,
): number | null {
  const stored = row.cost_price;
  if (
    stored != null &&
    Number.isFinite(Number(stored)) &&
    Number(stored) >= 0
  ) {
    return roundWon(Number(stored));
  }

  const qty = row.quantity != null ? Number(row.quantity) : NaN;
  const qtySafe = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const labor = row.labor_fee != null ? Number(row.labor_fee) : NaN;
  const isVendorPurchase = String(row.vendor_name ?? "").trim() === "매입";
  const laborCostWon =
    !isVendorPurchase && Number.isFinite(labor) && labor >= 0
      ? roundWon(labor * qtySafe)
      : 0;

  // 월 매출장부 요청: 중량이 0인 행은 금속원가 대신 공임(×수량)을 원가로 본다.
  const w0 = row.weight_g != null ? Number(row.weight_g) : NaN;
  if (Number.isFinite(w0) && w0 === 0) {
    return laborCostWon;
  }

  if (row.kind === "silver") {
    const p = processingSilverPerDon;
    if (p == null || !Number.isFinite(p) || p < 0) return null;
    const w = row.weight_g;
    if (w == null || !Number.isFinite(Number(w)) || Number(w) <= 0) {
      // Some silver sales (e.g., bars) are tracked by quantity without weight.
      // In that case, treat quantity as "돈 수" and compute cost as (원/돈 * 수량).
      if (!Number.isFinite(qty) || qty <= 0) return null;
      return roundWon(p * qty + laborCostWon);
    }
    const sc = calculateSilverPurchase({
      pricePerDon: p,
      weightG: Number(w),
      purity: defaultSilverPurity(row.purity),
    });
    if (!sc) return null;
    return roundWon(sc.amount * qtySafe + laborCostWon);
  }

  if (row.kind === "other") return null;

  const p = processingGoldPerDon;
  if (p == null || !Number.isFinite(p) || p < 0) return null;

  // Sales ledger special: 14K cost uses (g/3.75) * 0.6435 * quote + labor
  // (matches shop rule used in suggested sell calc)
  if (row.kind === "gold_14k" || String(row.purity ?? "").trim() === "14K") {
    const w = row.weight_g;
    const wNum = w != null ? Number(w) : NaN;
    if (Number.isFinite(wNum) && wNum > 0) {
      const don = wNum / 3.75;
      const metal = roundWon(p * don * 0.6435);
      return roundWon(metal * qtySafe + laborCostWon);
    }
    // If weight is missing, fall back to default processing-cost logic below.
  }

  const metal = processingCostWonFromQuote(p, purchaseLikeFromInventory(row));
  if (metal == null) return null;
  return roundWon(metal * qtySafe + laborCostWon);
}

export function inventorySaleMarginWon(
  processingGoldPerDon: number | null,
  processingSilverPerDon: number | null,
  row: InventoryItem,
): number | null {
  const sell = row.sell_price != null ? Number(row.sell_price) : NaN;
  if (!Number.isFinite(sell)) return null;
  const cost = inventorySaleMetalCostWon(
    processingGoldPerDon,
    processingSilverPerDon,
    row,
  );
  if (cost == null) return null;
  return roundWon(sell - cost);
}
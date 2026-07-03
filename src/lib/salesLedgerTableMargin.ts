import {
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
  seoulYmdFromIso,
} from "@/lib/format";
import { isPurchaseVendorName } from "@/lib/productLaborFeeMatch";
import {
  JONGRO_QUOTE_SCOPE_GOLD,
  JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER,
  JONGRO_QUOTE_SCOPE_SILVER,
  type InventoryItem,
} from "@/types/db";

/**
 * 결제란 공백·전각 공백·NFKC 호환 문자·영문 CARD 등을 카드로 인식합니다.
 * (DB·엑셀에서 `카드`와 동일하지 않은 문자열로 들어와 종로 입력이 막히는 경우 방지)
 */
export function isCardLedgerPayment(raw: string | null | undefined): boolean {
  let t = String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u00a0\u200b-\u200d\ufeff\u3000]/g, "")
    .trim();
  t = t.replace(/\s+/g, "");
  if (t === "\uCE74\uB4DC") return true;
  if (t.startsWith("\uCE74\uB4DC")) return true;
  const u = t.toUpperCase();
  if (u === "CARD") return true;
  if (u.includes("CREDIT") && u.includes("CARD")) return true;
  return false;
}

export function isOtherLedgerPayment(raw: string | null | undefined): boolean {
  return (
    String(raw ?? "")
      .normalize("NFKC")
      .trim() === "기타"
  );
}

/** 결제 `현영`(현금영수증) */
export function isCashReceiptLedgerPayment(
  raw: string | null | undefined,
): boolean {
  let t = String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u00a0\u200b-\u200d\ufeff\u3000]/g, "")
    .trim();
  t = t.replace(/\s+/g, "");
  if (t === "현영") return true;
  if (t.startsWith("현영")) return true;
  if (t.includes("현금영수증")) return true;
  return false;
}

/** 월 매출장부 필터: 결제 `카드` 또는 `현영` */
export function isCardOrCashReceiptLedgerPayment(
  raw: string | null | undefined,
): boolean {
  return isCardLedgerPayment(raw) || isCashReceiptLedgerPayment(raw);
}

/**
 * 금(24K/14K/18K) 원가 계수. DB `kind` 외에 엑셀 등에서 `24K` 문자열로 들어온 경우 포함.
 */
export function salesLedgerGoldQuoteFactor(
  kind: string | null | undefined,
): number | null {
  const k = String(kind ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (k === "gold_14k" || k === "14K" || k === "14k") return 0.6435;
  if (k === "gold_18k" || k === "18K" || k === "18k") return 0.826;
  if (
    k === "gold" ||
    k === "24K" ||
    k === "24k" ||
    k === "24K-1" ||
    k.toUpperCase() === "GOLD"
  ) {
    return 1;
  }
  return null;
}

export function goldQuotePerDonForSalesLedger(
  quoteMap: Map<string, number>,
  ymd: string,
): number | null {
  const sales = quoteMap.get(`${ymd}|${JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER}`);
  if (sales != null && Number.isFinite(sales) && sales > 0) return sales;
  const base = quoteMap.get(`${ymd}|${JONGRO_QUOTE_SCOPE_GOLD}`);
  if (base != null && Number.isFinite(base) && base > 0) return base;
  return null;
}

/**
 * 매출장부 한 행에 적용할 원/돈 시세(종로).
 * - 금(24K/14K/18K) + 결제 `카드`: 당일 시세 기본, 행 입력·DB override가 있으면 그 값.
 * - 은: 행별 입력·override 우선, 없으면 당일 은 시세.
 * - 그 외 금: 당일 시세만.
 */
export function salesLedgerEffectiveQuotePerDonForRow(
  r: InventoryItem,
  quoteMap: Map<string, number>,
  jongroQuoteEdits: Record<string, string>,
): number | null {
  const sold = r.sold_at ?? r.updated_at;
  const ymd = seoulYmdFromIso(sold);
  const isCard = isCardLedgerPayment(r.payment_method);
  const goldPBase = goldQuotePerDonForSalesLedger(quoteMap, ymd);
  const silverPBase =
    quoteMap.get(`${ymd}|${JONGRO_QUOTE_SCOPE_SILVER}`) ?? null;

  const editDigits = jongroQuoteEdits[r.id]?.trim() ?? "";
  const editN =
    editDigits.length > 0 ? parseWonDigitsToNumber(editDigits) : null;
  const editQuote =
    editN != null && Number.isFinite(editN) && editN > 0
      ? Math.round(editN)
      : null;
  const overrideN =
    r.jongro_quote_override_per_don != null
      ? Number(r.jongro_quote_override_per_don)
      : NaN;
  const override =
    Number.isFinite(overrideN) && overrideN > 0 ? Math.round(overrideN) : null;

  if (r.kind === "silver") {
    const base =
      silverPBase != null && Number.isFinite(Number(silverPBase))
        ? Math.round(Number(silverPBase))
        : null;
    return editQuote ?? override ?? base;
  }
  if (r.kind === "other") return null;
  if (isCard) {
    return editQuote ?? override ?? goldPBase;
  }
  return goldPBase;
}

/** 종로시세 입력칸에 넣을 기본 숫자열(당일 시세 또는 저장된 override). */
export function salesLedgerJongroInputDigitsDefault(
  r: InventoryItem,
  quoteMap: Map<string, number>,
  jongroQuoteEdits: Record<string, string>,
): string {
  const sold = r.sold_at ?? r.updated_at;
  const ymd = seoulYmdFromIso(sold);
  const isCard = isCardLedgerPayment(r.payment_method);
  const goldPBase = goldQuotePerDonForSalesLedger(quoteMap, ymd);
  const silverPBase =
    quoteMap.get(`${ymd}|${JONGRO_QUOTE_SCOPE_SILVER}`) ?? null;

  if (Object.prototype.hasOwnProperty.call(jongroQuoteEdits, r.id)) {
    return jongroQuoteEdits[r.id] ?? "";
  }
  const overrideN =
    r.jongro_quote_override_per_don != null
      ? Number(r.jongro_quote_override_per_don)
      : NaN;
  if (Number.isFinite(overrideN) && overrideN > 0) {
    return sanitizeWonInputDigits(String(Math.round(overrideN)));
  }
  if (r.kind === "silver") {
    if (
      silverPBase != null &&
      Number.isFinite(Number(silverPBase)) &&
      Number(silverPBase) > 0
    ) {
      return sanitizeWonInputDigits(String(Math.round(Number(silverPBase))));
    }
    return "";
  }
  if (r.kind === "other") return "";
  if (isCard && goldPBase != null && Number.isFinite(goldPBase) && goldPBase > 0) {
    return sanitizeWonInputDigits(String(Math.round(goldPBase)));
  }
  if (!isCard && goldPBase != null && Number.isFinite(goldPBase) && goldPBase > 0) {
    return sanitizeWonInputDigits(String(Math.round(goldPBase)));
  }
  return "";
}

export function salesLedgerTableDisplayedMarginWon(
  r: InventoryItem,
  quoteMap: Map<string, number>,
  jongroQuoteEdits: Record<string, string>,
  laborEdits: Record<string, string>,
): number | null {
  const sold = r.sold_at ?? r.updated_at;
  const isCard = isCardLedgerPayment(r.payment_method);

  const sellNum = r.sell_price != null ? Number(r.sell_price) : NaN;
  const sellRounded = Number.isFinite(sellNum) ? Math.round(sellNum) : null;

  const isSilverBar = String(r.name ?? "").trim().includes("\uC2E4\uBC84\uBC14");
  const laborWon = (() => {
    if (Object.prototype.hasOwnProperty.call(laborEdits, r.id)) {
      const digits = String(laborEdits[r.id] ?? "").trim();
      if (!digits) return 0;
      const n = parseWonDigitsToNumber(digits);
      return n != null && Number.isFinite(n) ? Math.round(n) : 0;
    }
    if (isPurchaseVendorName(r.vendor_name)) return 0;
    const stored =
      r.labor_fee != null && Number.isFinite(Number(r.labor_fee))
        ? Math.round(Number(r.labor_fee))
        : 0;
    return stored;
  })();
  const silverBarCost = isSilverBar
    ? (() => {
        const fee = laborWon;
        const qty = Number.isFinite(Number(r.quantity))
          ? Math.round(Number(r.quantity))
          : null;
        if (fee == null || qty == null) return null;
        return Math.round(fee * qty);
      })()
    : null;
  const quotePerDon = salesLedgerEffectiveQuotePerDonForRow(
    r,
    quoteMap,
    jongroQuoteEdits,
  );
  const nowMetalWon = (() => {
    if (quotePerDon == null) return null;
    const w =
      r.weight_g != null && Number.isFinite(Number(r.weight_g))
        ? Number(r.weight_g)
        : null;
    if (w == null) return null;
    const factor = salesLedgerGoldQuoteFactor(r.kind);
    if (factor == null) return null;
    return Math.round((w / 3.75) * factor * quotePerDon);
  })();
  const qtyN =
    Number.isFinite(Number(r.quantity)) ? Math.round(Number(r.quantity)) : null;
  const unitSum = (laborWon ?? 0) + (nowMetalWon ?? 0);
  const baseCost = isSilverBar
    ? silverBarCost
    : qtyN != null
      ? Math.round(unitSum * qtyN)
      : null;
  const displayCost = baseCost;
  if (sellRounded == null || displayCost == null) return null;
  return Math.round((sellRounded - displayCost) / (isCard ? 1.1 : 1));
}
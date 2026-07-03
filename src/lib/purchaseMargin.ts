import {
  effectiveProcessingPerDon,
  effectiveWeightGForGoldPurchase,
  GRAMS_PER_DON,
  KARAT_FACTORS,
  ledgerDisplayDonFromWeightG,
  PROCESSING_QUOTE_OFFSET_PER_DON_24K1,
  roundWon,
} from "@/lib/goldPurchase";
import type { Purchase } from "@/types/db";

/**
 * Margin from processing: effective processing (24K-1 excludes analysis fee per don)
 * times pure gold don, minus actual purchase amount.
 */
export function marginFromProcessing(
  processingPerDon: number | null | undefined,
  pureGoldDon: number | null | undefined,
  totalAmount: number,
  karat?: string | null,
): number | null {
  if (
    processingPerDon == null ||
    pureGoldDon == null ||
    !Number.isFinite(Number(processingPerDon)) ||
    !Number.isFinite(Number(pureGoldDon))
  ) {
    return null;
  }
  const p = Number(processingPerDon);
  const d = Number(pureGoldDon);
  if (p < 0 || d < 0 || !Number.isFinite(totalAmount)) return null;
  const eff = effectiveProcessingPerDon(p, karat);
  return roundWon(eff * d - totalAmount);
}

export function isGoldLikeLedgerItem(itemType: string | null | undefined): boolean {
  return itemType === "\uAE08" || itemType === "\uCE58\uAE08";
}

export function effectivePureGoldDon(p: Purchase): number | null {
  if (
    p.pure_gold_don != null &&
    Number.isFinite(Number(p.pure_gold_don)) &&
    Number(p.pure_gold_don) > 0
  ) {
    return Number(p.pure_gold_don);
  }
  const w = p.weight_g;
  const kNorm = normalizeLedgerKarat(String(p.karat ?? p.purity ?? ""));
  if (w == null || !Number.isFinite(Number(w)) || Number(w) <= 0 || !kNorm) {
    return null;
  }
  const factor = KARAT_FACTORS[kNorm];
  if (factor == null) return null;
  const wAdj = effectiveWeightGForGoldPurchase(kNorm, Number(w));
  const pureG = wAdj * factor;
  return pureG / GRAMS_PER_DON;
}

/** 함량 문자열을 KARAT_FACTORS 키로 통일 (24K-1 변형·외국금 공백/NFKC 등). */
export function normalizeLedgerKarat(raw: string): string | null {
  const trimmed = String(raw ?? "").trim().normalize("NFKC");
  if (!trimmed) return null;
  if (trimmed === "크라운" || trimmed === "인레이") return trimmed;
  if (trimmed === "외국금" || trimmed.replace(/\s/g, "") === "외국금")
    return "외국금";
  let t = trimmed
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[‐‑–—−]/g, "-");
  t = t
    .replace(/^24K[-]?[IL]$/, "24K-1")
    .replace(/^24K[-]?ㅣ$/, "24K-1")
    .replace(/^24K[-]?1$/, "24K-1")
    .replace(/^24K1$/, "24K-1")
    .replace(/^24K-?I$/, "24K-1")
    .replace(/^24K-?L$/, "24K-1");
  if (t === "24K-1") return "24K-1";
  if (t === "24K") return "24K";
  if (t === "18K") return "18K";
  if (t === "14K") return "14K";
  if (t === "10K") return "10K";
  return null;
}

/**
 * 처리원가(원). 돈수 = 중량(g)÷3.75를 소수 둘째 자리로 반올림(장부 표시와 동일).
 * - 24K: 돈수×처리시세
 * - 외국금: (중량×0.9) 환산 돈수×처리시세
 * - 24K-1: max(0, 처리시세 − {@link PROCESSING_QUOTE_OFFSET_PER_DON_24K1}) × 돈수
 * - 18K: 돈수×0.739×처리시세
 * - 14K: 돈수×0.574×처리시세
 * - 10K·크라운·인레이 등: 돈수×처리시세×KARAT_FACTORS
 * 데이터 부족 시 순금돈×시세 등으로 보조 계산.
 */
export function processingCostWonFromQuote(
  pricePerDon: number,
  p: Purchase,
): number | null {
  if (!isGoldLikeLedgerItem(p.item_type)) return null;
  if (!Number.isFinite(pricePerDon) || pricePerDon < 0) return null;

  const w = p.weight_g;
  const kNorm = normalizeLedgerKarat(String(p.karat ?? p.purity ?? ""));
  if (
    w != null &&
    Number.isFinite(Number(w)) &&
    Number(w) > 0 &&
    kNorm != null
  ) {
    const wNum = Number(w);
    if (kNorm === "외국금") {
      const d = effectivePureGoldDon(p);
      if (d != null && d > 0) {
        return roundWon(pricePerDon * d);
      }
    }
    const wCalc = effectiveWeightGForGoldPurchase(kNorm, wNum);
    const weightDon = ledgerDisplayDonFromWeightG(wCalc);
    if (Number.isFinite(weightDon) && weightDon > 0) {
      if (kNorm === "24K") {
        return roundWon(pricePerDon * weightDon);
      }
      if (kNorm === "24K-1") {
        const effPerDon = Math.max(
          0,
          pricePerDon - PROCESSING_QUOTE_OFFSET_PER_DON_24K1,
        );
        return roundWon(effPerDon * weightDon);
      }
      if (kNorm === "18K") {
        return roundWon(pricePerDon * weightDon * KARAT_FACTORS["18K"]);
      }
      if (kNorm === "14K") {
        return roundWon(pricePerDon * weightDon * KARAT_FACTORS["14K"]);
      }
      const factor = KARAT_FACTORS[kNorm];
      if (factor != null) {
        return roundWon(pricePerDon * weightDon * factor);
      }
    }
  }

  const wn =
    w != null && Number.isFinite(Number(w)) && Number(w) > 0 ? Number(w) : null;
  if (
    wn != null &&
    kNorm == null &&
    isGoldLikeLedgerItem(p.item_type)
  ) {
    const pf =
      p.purity_factor != null && Number.isFinite(Number(p.purity_factor))
        ? Number(p.purity_factor)
        : null;
    if (pf != null && pf > 0 && pf <= 1.001) {
      const weightDon = ledgerDisplayDonFromWeightG(wn);
      if (Number.isFinite(weightDon) && weightDon > 0) {
        return roundWon(pricePerDon * weightDon * pf);
      }
    }
  }

  const d = effectivePureGoldDon(p);
  if (d == null || d <= 0) return null;
  const kFallback = normalizeLedgerKarat(String(p.karat ?? p.purity ?? ""));
  if (kFallback === "24K-1") {
    const effPerDon = Math.max(
      0,
      pricePerDon - PROCESSING_QUOTE_OFFSET_PER_DON_24K1,
    );
    return roundWon(effPerDon * d);
  }
  return roundWon(pricePerDon * d);
}

/** 의제 매입: 기준 마진에서 차감하는 부가세 비율 */
export const YIJE_VAT_RATE = 0.1;

/** 의제 매입 장부 돈수 (함량별 중량 보정 후 g÷3.75, 소수 둘째 자리) */
export function yijeDonForPurchase(p: Purchase): number | null {
  const w = p.weight_g;
  if (w == null || !Number.isFinite(Number(w)) || Number(w) <= 0) return null;
  const k = normalizeLedgerKarat(String(p.karat ?? p.purity ?? ""));
  if (k == null) return null;
  const wAdj = effectiveWeightGForGoldPurchase(k, Number(w));
  const don = ledgerDisplayDonFromWeightG(wAdj);
  return Number.isFinite(don) && don > 0 ? don : null;
}

/**
 * 월매입 장부 · 결제=의제 전용.
 * - 처리원가 = 수기 매입시세×돈 (24K-1도 시세에서 1만 원 차감 없음)
 * - 기준 마진 = 처리원가 − 손님 매입금액
 * - 최종 마진 = 기준 마진 − 기준마진×10% − (24K-1만 1만원×돈)
 */
export function yijeLedgerFieldsForPurchase(
  manualPurchaseQuotePerDon: number,
  p: Purchase,
): {
  gold_price_per_don: number;
  processing_price_per_don: number;
  margin_amount: number;
} | null {
  const don = yijeDonForPurchase(p);
  if (don == null) return null;
  const total = Number(p.total_amount);
  if (!Number.isFinite(total)) return null;
  const quote = Math.floor(manualPurchaseQuotePerDon);
  if (!Number.isFinite(quote) || quote < 0) return null;

  const processingCost = roundWon(quote * don);
  const baseMargin = roundWon(processingCost - total);
  const vat = roundWon(baseMargin * YIJE_VAT_RATE);
  const k = normalizeLedgerKarat(String(p.karat ?? p.purity ?? ""));
  const analysisDeduction =
    k === "24K-1"
      ? roundWon(PROCESSING_QUOTE_OFFSET_PER_DON_24K1 * don)
      : 0;
  const margin = roundWon(baseMargin - vat - analysisDeduction);

  return {
    gold_price_per_don: quote,
    processing_price_per_don: processingCost,
    margin_amount: margin,
  };
}

/** 일별 처리시세 반영: gold_price_per_don, 처리원가, 마진(처리원가 − 매입금액). */
export function processingLedgerFieldsForPurchase(
  pricePerDon: number,
  p: Purchase,
): {
  gold_price_per_don: number;
  processing_price_per_don: number;
  margin_amount: number;
} | null {
  const processingCost = processingCostWonFromQuote(pricePerDon, p);
  if (processingCost == null) return null;
  const total = Number(p.total_amount);
  if (!Number.isFinite(total)) return null;
  const margin = roundWon(processingCost - total);
  return {
    gold_price_per_don: pricePerDon,
    processing_price_per_don: processingCost,
    margin_amount: margin,
  };
}

/** When jongro_daily_quotes is missing or not in PostgREST schema cache */
export function jongroDailyQuotesSetupHint(message: string | null | undefined): string {
  const m = String(message ?? "");
  if (
    /jongro_daily_quotes|schema cache|Could not find the|42P01|does not exist|relation/i.test(
      m,
    )
  ) {
    return " Run supabase/migration_jongro_daily_quotes.sql in Supabase SQL Editor, then reload API schema if needed.";
  }
  if (/quote_scope|migration_jongro_quote_scope|23505|unique/i.test(m)) {
    return " For gold+silver quotes, run supabase/migration_jongro_quote_scope.sql in Supabase SQL Editor, then reload API schema.";
  }
  return "";
}

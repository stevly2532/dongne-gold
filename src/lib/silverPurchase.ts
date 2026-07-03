import { GRAMS_PER_DON, roundWon } from "./goldPurchase";
import type { Purchase } from "@/types/db";

export const SILVER_PURITIES = [
  "925",
  "\uC740\uC218\uC800 99",
  "\uC740\uC218\uC800 90",
  "\uC740\uC218\uC800 80",
  "\uC740\uC218\uC800 70",
  "\uC740\uC218\uC800 60",
  "\uC740 50",
] as const;

export type SilverPurity = (typeof SILVER_PURITIES)[number];

const LEGACY_SILVER_PURITY: Record<string, SilverPurity> = {
  "\uC740\uC218\uC80099": SILVER_PURITIES[1],
  "\uC74050": SILVER_PURITIES[6],
};

export function defaultSilverPurity(
  stored: string | null | undefined,
): SilverPurity {
  if (stored != null) {
    if ((SILVER_PURITIES as readonly string[]).includes(stored)) {
      return stored as SilverPurity;
    }
    const mapped = LEGACY_SILVER_PURITY[stored];
    if (mapped) return mapped;
  }
  return SILVER_PURITIES[0];
}

export function silverWeightMultiplier(purity: string): number {
  const p = defaultSilverPurity(purity);
  switch (p) {
    case "925":
      return 0.9;
    case "\uC740\uC218\uC800 99":
      return 0.98;
    case "\uC740\uC218\uC800 90":
      return 0.9;
    case "\uC740\uC218\uC800 80":
      return 0.8;
    case "\uC740\uC218\uC800 70":
      return 0.7;
    case "\uC740\uC218\uC800 60":
      return 0.6;
    case "\uC740 50":
      return 0.5;
    default:
      return 0.9;
  }
}

export type SilverPurchaseCalc = {
  mult: number;
  rawDon: number;
  effectiveG: number;
  billableDon: number;
  amount: number;
  pricePerDon: number;
};

export function calculateSilverPurchase(input: {
  pricePerDon: number;
  weightG: number;
  purity: string;
}): SilverPurchaseCalc | null {
  if (
    !Number.isFinite(input.pricePerDon) ||
    input.pricePerDon < 0 ||
    !Number.isFinite(input.weightG) ||
    input.weightG <= 0
  ) {
    return null;
  }
  const mult = silverWeightMultiplier(input.purity);
  const rawDon = input.weightG / GRAMS_PER_DON;
  const effectiveG = input.weightG * mult;
  const billableDon = effectiveG / GRAMS_PER_DON;
  const amount = billableDon * input.pricePerDon;
  return {
    mult,
    rawDon,
    effectiveG,
    billableDon,
    amount,
    pricePerDon: input.pricePerDon,
  };
}

export function silverProcessingLedgerFieldsFromQuote(
  pricePerDon: number,
  p: Pick<Purchase, "item_type" | "weight_g" | "purity" | "total_amount">,
): {
  gold_price_per_don: number;
  processing_price_per_don: number;
  margin_amount: number;
} | null {
  if (p.item_type !== "은") return null;
  if (!Number.isFinite(pricePerDon) || pricePerDon < 0) return null;
  const w = p.weight_g;
  if (w == null || !Number.isFinite(Number(w)) || Number(w) <= 0) return null;
  const calc = calculateSilverPurchase({
    pricePerDon,
    weightG: Number(w),
    purity: String(p.purity ?? "925"),
  });
  if (!calc) return null;
  const processingCost = roundWon(calc.amount);
  const total = Number(p.total_amount);
  if (!Number.isFinite(total)) return null;
  const margin = roundWon(processingCost - total);
  return {
    gold_price_per_don: pricePerDon,
    processing_price_per_don: processingCost,
    margin_amount: margin,
  };
}

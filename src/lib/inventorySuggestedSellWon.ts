import { GRAMS_PER_DON, KARAT_FACTORS, roundWon } from "@/lib/goldPurchase";
import { calculateSilverPurchase } from "@/lib/silverPurchase";

export function computeSuggestedInventorySellWon(input: {
  kind: string;
  weightG: string;
  laborFee: string;
  goldPricePerDon: number | null;
  silverPricePerDon: number | null;
}): number | null {
  const w = parseFloat(String(input.weightG).replace(",", "."));
  if (!Number.isFinite(w) || w <= 0) return null;

  const laborParsed = input.laborFee.trim()
    ? parseFloat(input.laborFee.replace(/,/g, ""))
    : 0;
  const labor =
    Number.isFinite(laborParsed) && laborParsed >= 0
      ? Math.round(laborParsed)
      : 0;

  if (input.kind === "silver") {
    const p = input.silverPricePerDon;
    if (p == null || !Number.isFinite(p) || p < 0) return null;
    const sc = calculateSilverPurchase({
      pricePerDon: p,
      weightG: w,
      purity: "925",
    });
    if (!sc) return null;
    return roundWon(Math.max(0, sc.amount) + labor);
  }

  if (input.kind === "other") return null;

  const karatKey =
    input.kind === "gold"
      ? "24K"
      : input.kind === "gold_18k"
        ? "18K"
        : input.kind === "gold_14k"
          ? "14K"
          : null;
  if (karatKey == null) return null;

  const factor = KARAT_FACTORS[karatKey];
  const p = input.goldPricePerDon;
  if (
    factor == null ||
    p == null ||
    !Number.isFinite(p) ||
    p < 0 ||
    !Number.isFinite(factor)
  ) {
    return null;
  }

  const pureGoldG = w * factor;
  const pureDon = pureGoldG / GRAMS_PER_DON;
  if (!Number.isFinite(pureDon) || pureDon <= 0) return null;

  const metalWon = roundWon(Math.max(0, p * pureDon));
  return roundWon(metalWon + labor);
}
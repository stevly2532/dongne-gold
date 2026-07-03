import { GRAMS_PER_DON } from "@/lib/goldPurchase";

/** 순금(돈) = (중량 g ÷ 3.75) × 계수 — 크라운·인레이 상이 */
export const CHIGUM_PURE_DON_FACTOR_CROWN = 0.55;
export const CHIGUM_PURE_DON_FACTOR_INLAY = 0.8;

export function chigumPureDonFactorForKind(kind: string): number {
  if (kind === "인레이") return CHIGUM_PURE_DON_FACTOR_INLAY;
  return CHIGUM_PURE_DON_FACTOR_CROWN;
}

export function chigumKindLabelFromPurchase(p: {
  karat?: string | null;
  purity?: string | null;
}): string {
  const k =
    p.karat != null && String(p.karat).trim() !== ""
      ? String(p.karat).trim()
      : null;
  const pur =
    p.purity != null && String(p.purity).trim() !== ""
      ? String(p.purity).trim()
      : null;
  return k ?? pur ?? "크라운";
}

export function chigumPureDonFromWeightG(weightG: number, kind: string): number {
  if (!Number.isFinite(weightG) || weightG <= 0) return 0;
  return (weightG / GRAMS_PER_DON) * chigumPureDonFactorForKind(kind);
}

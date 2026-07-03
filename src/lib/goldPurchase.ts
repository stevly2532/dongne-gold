export const GRAMS_PER_DON = 3.75;

/**
 * 중량(g)을 돈수로 바꾼 뒤 소수 둘째 자리로 반올림한 값.
 * 월매입 장부 돈수 열 표시와 처리원가 계산이 같은 숫자를 쓰도록 맞춘다.
 */
export function ledgerDisplayDonFromWeightG(grams: number): number {
  const g = Number(grams);
  if (!Number.isFinite(g)) return NaN;
  return Number((g / GRAMS_PER_DON).toFixed(2));
}

/**
 * 24K-1 매입등록: 입력 시세(원/돈)에서 돈당 뺄 금액.
 * 매입금액 = (시세 − 이 값) × 돈수(×함량·매입비).
 */
export const ANALYSIS_FEE_PER_DON_24K1 = 15_000;

/**
 * 24K-1 처리원가·마진(월매입 장부): 처리시세에서 돈당 뺄 금액.
 * max(0, 처리시세 − 이 값) × 돈수(장부 돈수 열과 동일 반올림).
 */
export const PROCESSING_QUOTE_OFFSET_PER_DON_24K1 = 10_000;

/**
 * 월매입 장부에서 24K-1 처리원가를 (처리시세−{@link PROCESSING_QUOTE_OFFSET_PER_DON_24K1})×돈으로
 * **다시 그려 보이기** 시작하는 날짜(한국 달력, 해당 일 0시(KST) 이후 `purchased_at`).
 * 그 전 날짜까지는 DB `processing_price_per_don`·연쇄 마진 표시를 그대로 둔다.
 */
export const LEDGER_24K1_RECALC_DISPLAY_FROM_SEOUL_YMD = "2026-04-12";

/** 외국금: 입력 중량(g)에 곱해 매입·돈수·순금 산출에 쓰는 계수 */
export const FOREIGN_GOLD_WEIGHT_MULT = 0.9;

export const KARAT_FACTORS: Record<string, number> = {
  "24K": 1,
  "24K-1": 1,
  /** 순도·처리원가 계산을 24K와 동일(1)로 둠; 중량은 {@link effectiveWeightGForGoldPurchase}로 보정 */
  외국금: 1,
  "18K": 0.739,
  "14K": 0.574,
  "10K": 10 / 24,
  /** 치금 함량(스크랩 평균에 맞춰 18K와 동일 계수로 둠, 필요 시 조정) */
  크라운: 0.739,
  인레이: 0.739,
};

/**
 * 금 매입·수정 다이얼로그 함량 셀렉트 (순서·라벨 단일 소스).
 * `value`는 DB·계산에 쓰이는 키, `label`은 화면 표시용.
 */
export const GOLD_PURCHASE_KARAT_OPTIONS = [
  { value: "24K", label: "24K" },
  { value: "24K-1", label: "24K-1" },
  { value: "외국금", label: "외국금" },
  { value: "18K", label: "18K" },
  { value: "14K", label: "14K" },
  { value: "10K", label: "10K" },
] as const;

export type GoldPurchaseKaratValue =
  (typeof GOLD_PURCHASE_KARAT_OPTIONS)[number]["value"];

const GOLD_PURCHASE_KARAT_VALUE_SET = new Set<string>(
  GOLD_PURCHASE_KARAT_OPTIONS.map((o) => o.value),
);

export function isGoldPurchaseKaratValue(
  s: string,
): s is GoldPurchaseKaratValue {
  return GOLD_PURCHASE_KARAT_VALUE_SET.has(s);
}

/**
 * 함량 문자열을 KARAT_FACTORS 키로 통일 (공백·NFKC·24K-1 표기 변형·「외국 금」 등).
 * DB/엑셀에서 들어온 값이 UI 옵션과 문자 단위로 다를 때도 동일하게 계산되게 한다.
 */
export function normalizeGoldKaratForPurchase(raw: string): string | null {
  const trimmed = String(raw ?? "").trim().normalize("NFKC");
  if (!trimmed) return null;
  if (trimmed === "크라운" || trimmed === "인레이") return trimmed;
  const noSpace = trimmed.replace(/\s/g, "");
  if (trimmed === "외국금" || noSpace === "외국금") return "외국금";
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

export function isForeignGoldKarat(karat: string): boolean {
  return normalizeGoldKaratForPurchase(karat) === "외국금";
}

/** No a/b/c purchase fee tier — 24K, 24K-1, 외국금 */
export function is24KFamilyNoFee(karat: string): boolean {
  const k = normalizeGoldKaratForPurchase(karat);
  return k === "24K" || k === "24K-1" || k === "외국금";
}

/** 외국금 순금 중량(g): 직접 입력값 우선, 없으면 중량×0.9(레거시). */
export function resolveForeignPureGoldG(
  weightG: number,
  pureGoldGOverride?: number | null,
): number {
  if (
    pureGoldGOverride != null &&
    Number.isFinite(pureGoldGOverride) &&
    pureGoldGOverride > 0
  ) {
    return pureGoldGOverride;
  }
  return weightG * FOREIGN_GOLD_WEIGHT_MULT;
}

export function parseForeignPureGoldGInput(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const n = parseFloat(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 금 매입 계산용 유효 중량(g). 외국금은 순금(g) 직접 입력 또는 0.9 환산. */
export function effectiveWeightGForGoldPurchase(
  karat: string,
  weightG: number,
  pureGoldGOverride?: number | null,
): number {
  if (!Number.isFinite(weightG) || weightG <= 0) return weightG;
  return isForeignGoldKarat(karat)
    ? resolveForeignPureGoldG(weightG, pureGoldGOverride)
    : weightG;
}

/** Effective processing price per don after 24K-1 analysis fee exclusion */
export function effectiveProcessingPerDon(
  processingPerDon: number,
  karat: string | null | undefined,
): number {
  const k = String(karat ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");
  if (k === "24K-1") {
    return Math.max(0, processingPerDon - PROCESSING_QUOTE_OFFSET_PER_DON_24K1);
  }
  return processingPerDon;
}

export type FeeTier = "a" | "b" | "c" | "none";

export function feeMultiplier(karat: string, tier: FeeTier): number {
  if (is24KFamilyNoFee(karat)) return 1;
  switch (tier) {
    case "a":
      return 0.95;
    case "b":
      return 0.9;
    case "c":
      return 0.85;
    default:
      return 1;
  }
}

/** 치금 매입비 계수: 매입금액 = 돈수(중량÷3.75) × 매입시세 × 계수 */
export function chigumFeeMultiplier(tier: FeeTier): number {
  switch (tier) {
    case "a":
      return 0.3;
    case "b":
      return 0.25;
    case "c":
      return 0.2;
    default:
      return 1;
  }
}

export type GoldPurchaseCalc = {
  weightDonRaw: number;
  pureGoldG: number;
  pureGoldDon: number;
  /** 시세 입력(원/돈); 24K-1은 매입 계산에 적용 시세가 다를 수 있음 */
  quotationPricePerDon: number;
  appliedPricePerDon: number;
  baseAmount: number;
  finalAmount: number;
};

/**
 * When import has paid total but no purchase price per don column,
 * derive implied won/don from weight, karat, fee tier, and total paid.
 */
export function impliedGoldPricePerDonFromTotal(input: {
  weightG: number;
  karat: string;
  feeTier: FeeTier;
  totalAmount: number;
  chigum?: boolean;
}): number | null {
  const karatNorm = normalizeGoldKaratForPurchase(input.karat);
  if (karatNorm == null) return null;
  const factor = KARAT_FACTORS[karatNorm];
  if (factor == null) return null;
  const wEff = effectiveWeightGForGoldPurchase(karatNorm, input.weightG);
  const weightDonRaw = wEff / GRAMS_PER_DON;
  const mult = input.chigum
    ? chigumFeeMultiplier(input.feeTier)
    : feeMultiplier(karatNorm, input.feeTier);
  if (!input.chigum && karatNorm === "10K") {
    const denom = weightDonRaw * mult * 0.4;
    if (!Number.isFinite(denom) || denom <= 0) return null;
    return input.totalAmount / denom;
  }
  const denom = input.chigum
    ? weightDonRaw * mult
    : weightDonRaw * factor * mult;
  if (!Number.isFinite(denom) || denom <= 0) return null;
  return input.totalAmount / denom;
}

export function calculateGoldPurchase(input: {
  pricePerDon: number;
  weightG: number;
  karat: string;
  feeTier: FeeTier;
  /** 치금: 돈수 × 매입시세 × 매입비(a/b/c) — 함량은 순금·처리원가용으로만 사용 */
  chigum?: boolean;
  /** 외국금: 순금 중량(g) 직접 지정. 없으면 계산하지 않음(레거시 0.9 자동 환산은 저장된 행 조회용). */
  pureGoldGOverride?: number | null;
}): GoldPurchaseCalc | null {
  const karatNorm = normalizeGoldKaratForPurchase(input.karat);
  if (karatNorm == null) return null;
  const factor = KARAT_FACTORS[karatNorm];
  if (
    factor == null ||
    !Number.isFinite(input.pricePerDon) ||
    !Number.isFinite(input.weightG) ||
    input.weightG <= 0 ||
    input.pricePerDon < 0
  ) {
    return null;
  }

  if (isForeignGoldKarat(karatNorm) && !input.chigum) {
    const pureG =
      input.pureGoldGOverride != null &&
      Number.isFinite(input.pureGoldGOverride) &&
      input.pureGoldGOverride > 0
        ? input.pureGoldGOverride
        : null;
    if (pureG == null) return null;
  }

  const wEff = effectiveWeightGForGoldPurchase(
    karatNorm,
    input.weightG,
    input.pureGoldGOverride,
  );
  const weightDonRaw = wEff / GRAMS_PER_DON;
  const pureGoldG = wEff * factor;
  const pureGoldDon = pureGoldG / GRAMS_PER_DON;

  if (input.chigum) {
    const mult = chigumFeeMultiplier(input.feeTier);
    const unitPricePerDon = input.pricePerDon;
    const baseAmount = unitPricePerDon * weightDonRaw;
    /** 원 단위 반올림 없이 보존 — 화면·저장 시 천 원 미만 절사 */
    const finalAmount = baseAmount * mult;
    return {
      weightDonRaw,
      pureGoldG,
      pureGoldDon,
      quotationPricePerDon: input.pricePerDon,
      appliedPricePerDon: unitPricePerDon,
      baseAmount,
      finalAmount,
    };
  }

  const unitPricePerDon =
    karatNorm === "24K-1"
      ? Math.max(0, input.pricePerDon - ANALYSIS_FEE_PER_DON_24K1)
      : input.pricePerDon;

  if (karatNorm === "10K") {
    const mult = feeMultiplier("10K", input.feeTier);
    const baseAmount = unitPricePerDon * weightDonRaw * 0.4;
    const finalAmount = baseAmount * mult;
    return {
      weightDonRaw,
      pureGoldG: wEff * factor,
      pureGoldDon,
      quotationPricePerDon: input.pricePerDon,
      appliedPricePerDon: unitPricePerDon,
      baseAmount,
      finalAmount,
    };
  }

  const baseAmount = unitPricePerDon * weightDonRaw * factor;
  const mult = feeMultiplier(karatNorm, input.feeTier);
  const finalAmount = baseAmount * mult;

  return {
    weightDonRaw,
    pureGoldG,
    pureGoldDon,
    quotationPricePerDon: input.pricePerDon,
    appliedPricePerDon: unitPricePerDon,
    baseAmount,
    finalAmount,
  };
}

export function roundWon(n: number) {
  return Math.round(n);
}

/** 레거시: 유효 처리시세(원/돈)×순금돈(24K-1 분석비 반영). 편집 다이얼로그 마진용. */
export function jongnoGrossWon(
  processingPerDon: number | null | undefined,
  pureGoldDon: number | null | undefined,
  karat: string | null | undefined,
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
  if (p < 0 || d < 0) return null;
  const eff = effectiveProcessingPerDon(p, karat);
  return roundWon(eff * d);
}

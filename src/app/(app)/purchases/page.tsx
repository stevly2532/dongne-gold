"use client";

import { DailyVaultPanel } from "@/components/DailyVaultPanel";
import { HelpTooltip } from "@/components/HelpTooltip";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  floorWonTo1000,
  formatKRW,
  dailyLedgerDateCellParts,
  purchaseLedgerDateCellParts,
  formatWonInputDisplay,
  localYmdFromIso,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
  seoulYmdFromIso,
} from "@/lib/format";
import {
  ANALYSIS_FEE_PER_DON_24K1,
  GRAMS_PER_DON,
  KARAT_FACTORS,
  type FeeTier,
  type GoldPurchaseKaratValue,
  calculateGoldPurchase,
  effectiveWeightGForGoldPurchase,
  is24KFamilyNoFee,
  isForeignGoldKarat,
  ledgerDisplayDonFromWeightG,
  normalizeGoldKaratForPurchase,
  parseForeignPureGoldGInput,
  roundWon,
} from "@/lib/goldPurchase";
import {
  formatMobileInputDisplay,
  normalizeKoreanMobilePhone,
} from "@/lib/koreanPhone";
import {
  branchLabelForId,
  branchLabelsById,
  branchesForShopSelect,
  firstShopSelectableBranchId,
} from "@/lib/branchLabels";
import { RegistrationPageHeader } from "@/components/RegistrationPageHeader";
import { LedgerSelectionSumBar } from "@/components/LedgerSelectionSumBar";
import { useAppBootstrap } from "@/components/AppProviders";
import { PurchaseEditDialog } from "@/components/PurchaseEditDialog";
import { useEnterAdvance } from "@/lib/useEnterAdvance";
import {
  matchesLedgerCustomerSearch,
  purchaseLedgerSearchExtraTerms,
} from "@/lib/ledgerCustomerSearch";
import {
  SILVER_PURITIES,
  type SilverPurity,
  calculateSilverPurchase,
  silverProcessingLedgerFieldsFromQuote,
} from "@/lib/silverPurchase";
import { processingLedgerFieldsForPurchase } from "@/lib/purchaseMargin";
import { swrLoad } from "@/lib/queryCache";
import {
  isCustomerDisplayPayloadEmpty,
  postCustomerDisplayMessage,
  type CustomerDisplayLine,
  type CustomerDisplayPayload,
} from "@/lib/customerDisplayBus";
import type { KoreanGoldQuoteResponse } from "@/app/api/korean-gold-prices/route";
import {
  fetchGoldgoldQuotesInBrowser,
  relayGoldgoldQuoteToServer,
} from "@/lib/goldgoldClientQuotes";
import {
  DAILY_PURCHASE_PRICE_SCOPE_GOLD,
  DAILY_PURCHASE_PRICE_SCOPE_SILVER,
  JONGRO_QUOTE_SCOPE_GOLD,
  JONGRO_QUOTE_SCOPE_SILVER,
  type Branch,
  type DailyPurchasePriceScope,
  type Profile,
  type Purchase,
} from "@/types/db";

/** 매입시세 캐시(서버 미응답 동안 비어보이지 않도록). 서버가 진실의 원천. */
const LS_GOLD_PRICE = "goldLedger_goldPricePerDon";
const LS_SILVER_PRICE = "goldLedger_silverPricePerDon";
const LS_LAST_SELLER_NAME = "goldLedger_lastSellerName";
const LS_LAST_SELLER_PHONE = "goldLedger_lastSellerPhone";

function isMissingDailyPriceTableError(err: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!err) return false;
  const m = (err.message ?? "").toLowerCase();
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    m.includes("does not exist") ||
    m.includes("schema cache")
  );
}

/** Ctrl/⌘+C 복사 시 첫 줄 헤더(표 열 순서와 동일, 삭제 열 제외) */
const PURCHASE_LEDGER_CLIPBOARD_HEADERS = [
  "매입시세",
  "날짜",
  "매장",
  "품목",
  "고객명",
  "전화번호",
  "중량(g)",
  "돈수",
  "함량",
  "매입비",
  "매입금액",
  "결제",
  "특이사항",
  "수정",
  "삭제",
] as const;

function todayRangeLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const iso = `${y}-${m}-${day}`;
  return { from: iso, to: iso };
}

/** 매입내역 기본 조회: 한국일 기준 당월 1일 ~ 말일 */
function currentMonthRangeSeoul(): { from: string; to: string } {
  const today = todayYmdSeoul();
  const [ys, ms] = today.split("-");
  const year = Number(ys);
  const month = Number(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;
  return { from, to };
}

/** 매장 시재·당일 합계는 기기 로컬이 아니라 한국 날짜로 통일 (PC/모바일·해외 시차 대비) */
function todayYmdSeoul(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

type KaratKey = GoldPurchaseKaratValue;
type ChigumKarat = "크라운" | "인레이";
type GoldKaratSelection = KaratKey | ChigumKarat;

/**
 * 매입등록 추가 행(같은 거래·여러 명세).
 * 거래 공통 필드(매장/고객명/전화번호/특이사항)는 첫 행 값을 따라가고,
 * 품목·함량·매입비·결제 방식은 행별로 다를 수 있다(한 사람이 금·은·치금 동시 매입).
 */
type ExtraPurchaseRow = {
  rid: string;
  /** 행별 품목(금/은/치금/기타) — 한 거래에 품목이 섞일 수 있다. */
  itemType: string;
  paymentMethod: string;
  weightG: string;
  /** 외국금: 순금 중량(g) 직접 입력 */
  foreignPureGoldG: string;
  /** 빈 문자열 = "선택" placeholder 상태(아직 함량 미지정) */
  karat: GoldKaratSelection | "";
  feeTier: FeeTier;
  totalAmount: string;
  /** 사용자가 매입금액을 직접 수정하면 true — 줄추가 등으로 자동계산이 덮어쓰지 않음 */
  totalAmountUserEdited: boolean;
  purity: string;
  unitPrice: string;
  silverPurity: SilverPurity;
};

/** 품목 문자열로 매입 플로우 플래그 도출 (첫 행·추가 행 공통) */
function purchaseLedgerToolbarPill(active: boolean) {
  return active
    ? "tongsang-pill tongsang-pill-active px-1.5 py-0.5 text-[10px] leading-tight"
    : "tongsang-pill tongsang-pill-inactive px-1.5 py-0.5 text-[10px] leading-tight";
}

/** 매입내역 툴바 — 검색·기간 동일 높이·톤, 가로만 요소별로 조절 */
const purchaseLedgerToolbarField =
  "purchase-ledger-field-input !mt-0 h-8 !text-xs tabular-nums";

function purchaseFlowFlags(it: string) {
  const usesGoldFlow = it === "금" || it === "치금";
  const isChigum = it === "치금";
  const usesSilverFlow = it === "은";
  // 백금: 함량·매입비 없이 중량/3.75 돈수만 표시(시세 자동계산 없음, 매입금액 직접 입력)
  const usesPlatinumFlow = it === "백금";
  const usesWeightDonDisplay =
    usesGoldFlow || usesSilverFlow || usesPlatinumFlow;
  return {
    usesGoldFlow,
    isChigum,
    usesSilverFlow,
    usesPlatinumFlow,
    usesWeightDonDisplay,
  };
}

function makeExtraRowId(): string {
  return `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankExtraRow(seed: {
  itemType: string;
  paymentMethod: string;
  feeTier: FeeTier;
  silverPurity: SilverPurity;
  karat: GoldKaratSelection | "";
}): ExtraPurchaseRow {
  return {
    rid: makeExtraRowId(),
    itemType: seed.itemType,
    paymentMethod: seed.paymentMethod,
    weightG: "",
    foreignPureGoldG: "",
    karat: seed.itemType === "치금" ? "크라운" : seed.karat,
    feeTier: seed.feeTier,
    totalAmount: "",
    totalAmountUserEdited: false,
    purity: "",
    unitPrice: "",
    silverPurity: seed.silverPurity,
  };
}

/**
 * 매입등록 카드 우측 상단의 관리자 전용 계산 미리보기.
 * 입력 누락(시세·중량·함량)을 항목별로 안내하고,
 * 모두 갖춰지면 goldCalc/silverCalc 결과를 컴팩트하게 표시.
 */
function PurchaseCalcPreview(props: {
  usesGoldFlow: boolean;
  usesSilverFlow: boolean;
  isChigum: boolean;
  karat: GoldKaratSelection | "";
  weightG: string;
  foreignPureGoldG?: string;
  goldPriceDigits: string;
  silverPriceDigits: string;
  goldCalc: ReturnType<typeof calculateGoldPurchase> | null;
  silverCalc: ReturnType<typeof calculateSilverPurchase> | null;
  /** 매입등록 우측 통합 패널 안에 넣을 때 외곽 카드 생략 */
  embedded?: boolean;
}) {
  const {
    usesGoldFlow,
    usesSilverFlow,
    isChigum,
    karat,
    weightG,
    foreignPureGoldG = "",
    goldPriceDigits,
    silverPriceDigits,
    goldCalc,
    silverCalc,
  } = props;

  const missing: string[] = [];
  const priceDigits = usesGoldFlow ? goldPriceDigits : silverPriceDigits;
  const priceN = parseWonDigitsToNumber(priceDigits);
  if (!priceN || priceN <= 0) {
    missing.push(usesGoldFlow ? "오늘의 시세" : "오늘의 시세(은)");
  }
  const wN = parseFloat(weightG.replace(",", "."));
  if (!Number.isFinite(wN) || wN <= 0) missing.push("중량(g)");
  if (usesGoldFlow && !karat) missing.push("함량");
  if (usesGoldFlow && !isChigum && isForeignGoldKarat(karat)) {
    const pureG = parseForeignPureGoldGInput(foreignPureGoldG);
    if (pureG == null) missing.push("순금(g)");
  }

  const labelTitle = usesGoldFlow
    ? isChigum
      ? "계산 미리보기 (치금)"
      : "계산 미리보기 (금)"
    : "계산 미리보기 (은)";

  const box =
    props.embedded === true
      ? "text-[11px] leading-snug text-[var(--foreground)]"
      : "toss-filter-inactive w-full shrink-0 rounded-md px-2.5 py-2 text-[11px] leading-snug lg:max-w-sm lg:w-72";

  return (
    <div className={box}>
      <p className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--foreground)]">
        <span>{labelTitle}</span>
        <span className="toss-badge">관리자</span>
      </p>
      {usesGoldFlow ? (
        goldCalc ? (
          <ul className="mt-1.5 space-y-0.5 text-[var(--foreground)]">
            <li>
              중량 환산: {goldCalc.weightDonRaw.toFixed(2)} 돈
              {isForeignGoldKarat(karat)
                ? ` (순금 ${parseForeignPureGoldGInput(foreignPureGoldG)?.toFixed(2) ?? "?"}g÷${GRAMS_PER_DON})`
                : ` (g÷${GRAMS_PER_DON})`}
            </li>
            <li>돈수: {goldCalc.pureGoldDon.toFixed(2)}</li>
            {karat === "24K-1" ? (
              <li>
                24K-1 적용: {formatKRW(roundWon(goldCalc.appliedPricePerDon))}/돈
                <span className="text-[var(--muted)]">
                  {" "}
                  (−{ANALYSIS_FEE_PER_DON_24K1.toLocaleString("ko-KR")})
                </span>
              </li>
            ) : null}
            <li>
              {isChigum
                ? "시세×돈수 (매입비 전): "
                : karat === "10K"
                  ? "돈수×0.4×시세×매입비 (전): "
                  : "시세×돈×순도 (매입비 전): "}
              {formatKRW(roundWon(goldCalc.baseAmount))}
            </li>
            <li className="toss-summary-highlight mt-1 rounded-md px-1.5 py-1 text-center text-[11px] font-bold leading-snug">
              예상 매입 {formatKRW(floorWonTo1000(goldCalc.finalAmount))}
            </li>
          </ul>
        ) : (
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            <span className="font-medium text-[var(--foreground)]">입력 필요: </span>
            {missing.length > 0 ? missing.join(", ") : "입력값을 확인하세요"}
          </p>
        )
      ) : null}
      {usesSilverFlow ? (
        silverCalc ? (
          <ul className="mt-1.5 space-y-0.5 text-[var(--foreground)]">
            <li>함량 배율: ×{silverCalc.mult}</li>
            <li>
              환산 중량: {silverCalc.effectiveG.toFixed(4)} g
            </li>
            <li>
              정산 돈수: {silverCalc.billableDon.toFixed(2)} 돈
              <span className="text-[var(--muted)]"> (÷{GRAMS_PER_DON})</span>
            </li>
            <li className="toss-summary-highlight mt-1 rounded-md px-1.5 py-1 text-center text-[11px] font-bold leading-snug">
              예상 매입 {formatKRW(floorWonTo1000(silverCalc.amount))}
            </li>
          </ul>
        ) : (
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            <span className="font-medium text-[var(--foreground)]">입력 필요: </span>
            {missing.length > 0 ? missing.join(", ") : "입력값을 확인하세요"}
          </p>
        )
      ) : null}
    </div>
  );
}

/**
 * 매입등록 한켠에 띄우는 "내가 팔 때(판매)" 시세 요약 스트립.
 * 고객화면과 동일 — 브라우저가 goldgold API 직접 fetch(30초), 실패 시 서버 API.
 */
const SELL_LINEUP_POLL_MS = 30_000;
const SELL_LINEUP_RETRY_MS = 10_000;
const SELL_LINEUP_DEFS: ReadonlyArray<{
  key: "pure" | "k18" | "k14" | "white" | "silver";
  label: string;
}> = [
  { key: "pure", label: "순금" },
  { key: "k18", label: "18K" },
  { key: "k14", label: "14K" },
  { key: "white", label: "백금" },
  { key: "silver", label: "은" },
];

function SellPriceLineupStrip(props: { embedded?: boolean }) {
  const [data, setData] = useState<KoreanGoldQuoteResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = setTimeout(load, delayMs);
    };

    const load = async () => {
      let success = false;
      try {
        const direct = await fetchGoldgoldQuotesInBrowser();
        if (!cancelled && direct?.ok) {
          setData(direct);
          success = true;
          void relayGoldgoldQuoteToServer(direct);
        } else {
          const res = await fetch("/api/korean-gold-prices", {
            cache: "no-store",
          });
          if (res.ok) {
            const json = (await res.json()) as KoreanGoldQuoteResponse;
            if (!cancelled && json.ok) {
              setData(json);
              success = true;
            }
          }
        }
      } catch {
        /* 다음 주기에 재시도 */
      } finally {
        schedule(success ? SELL_LINEUP_POLL_MS : SELL_LINEUP_RETRY_MS);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const box =
    props.embedded === true
      ? ""
      : "toss-filter-inactive w-full shrink-0 rounded-md px-2.5 py-2 lg:w-72 lg:max-w-xs";

  return (
    <div className={box}>
      <p className="text-[11px] font-semibold leading-tight">내가 팔 때 (원/돈)</p>
      <ul className="mt-1.5 space-y-1">
        {SELL_LINEUP_DEFS.map((d) => {
          const sell = data?.rows[d.key]?.sell ?? null;
          return (
            <li
              key={d.key}
              className="flex items-center justify-between gap-2 text-[11px] leading-snug"
            >
              <span className="shrink-0 opacity-75">{d.label}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {sell != null
                  ? `${Math.round(sell).toLocaleString("ko-KR")}`
                  : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function PurchasesPage() {
  const pathname = usePathname();
  const purchaseLedgerSumRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const bootstrap = useAppBootstrap();
  const initialLedgerRange = currentMonthRangeSeoul();

  const [profile, setProfile] = useState<Profile | null>(bootstrap.profile);
  const [branches, setBranches] = useState<Branch[]>(bootstrap.branches);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const [fromDate, setFromDate] = useState(initialLedgerRange.from);
  const [toDate, setToDate] = useState(initialLedgerRange.to);

  /** 매입내역 표: 날짜 정렬(기본 내림차순) · 오늘(서울일)만 */
  const [purchaseLedgerDateSortAsc, setPurchaseLedgerDateSortAsc] =
    useState(false);
  const [purchaseLedgerTodayOnly, setPurchaseLedgerTodayOnly] =
    useState(false);
  /** 매입내역 표: 고객명·전화번호·제품명(품목·함량·특이사항) 검색어 */
  const [purchaseLedgerSearch, setPurchaseLedgerSearch] = useState("");
  /**
   * 검색어가 있을 때 조회 기간(fromDate~toDate)을 무시하고 DB 전체에서 매칭한 결과.
   * null = 검색 안 함(기존 purchases 사용), [] = 검색했지만 결과 없음.
   */
  const [purchaseLedgerSearchResults, setPurchaseLedgerSearchResults] =
    useState<Purchase[] | null>(null);
  const [purchaseLedgerSearchLoading, setPurchaseLedgerSearchLoading] =
    useState(false);

  const [branchId, setBranchId] = useState<string>("");
  const [itemType, setItemType] = useState("금");
  const [weightG, setWeightG] = useState("");
  const [purity, setPurity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("현금");

  const purchasePaymentOptions = ["현금", "통장", "의제", "기타"] as const;

  useEffect(() => {
    setPaymentMethod((p) => (p === "카드" ? "기타" : p));
  }, []);
  const [note, setNote] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerPhone, setSellerPhone] = useState("");
  const [reusePrevSeller, setReusePrevSeller] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);

  const [goldPricePerDon, setGoldPricePerDon] = useState("");
  /** 빈 문자열 = "선택" 상태(아직 함량 미지정). 등록 전 반드시 선택해야 함. */
  const [karat, setKarat] = useState<GoldKaratSelection | "">("");
  const [foreignPureGoldG, setForeignPureGoldG] = useState("");
  const [feeTier, setFeeTier] = useState<FeeTier>("none");
  const [silverPricePerDon, setSilverPricePerDon] = useState("");
  const [silverPurity, setSilverPurity] = useState<SilverPurity>(
    SILVER_PURITIES[0],
  );

  /** 같은 거래 안에서 함량(또는 결제)이 다른 추가 명세 — 첫 행 외에 줄 추가용 */
  const [extraRows, setExtraRows] = useState<ExtraPurchaseRow[]>([]);

  const addExtraRow = useCallback(() => {
    setExtraRows((rs) => [
      ...rs,
      blankExtraRow({
        itemType,
        paymentMethod,
        feeTier,
        silverPurity,
        karat: itemType === "치금" ? "크라운" : karat,
      }),
    ]);
  }, [itemType, paymentMethod, feeTier, silverPurity, karat]);

  const removeExtraRow = useCallback((rid: string) => {
    setExtraRows((rs) => rs.filter((r) => r.rid !== rid));
  }, []);

  const updateExtraRow = useCallback(
    (rid: string, patch: Partial<ExtraPurchaseRow>) => {
      setExtraRows((rs) =>
        rs.map((r) => {
          if (r.rid !== rid) return r;
          const recalcInputsChanged =
            "weightG" in patch ||
            "karat" in patch ||
            "feeTier" in patch ||
            "itemType" in patch ||
            "silverPurity" in patch;
          const amountManuallyEdited =
            "totalAmount" in patch && !recalcInputsChanged;
          return {
            ...r,
            ...patch,
            ...(recalcInputsChanged ? { totalAmountUserEdited: false } : {}),
            ...(amountManuallyEdited ? { totalAmountUserEdited: true } : {}),
          };
        }),
      );
    },
    [],
  );

  /** 오늘의 매입시세: 서버에서 마지막으로 받은 값(원본 숫자) — 변경 감지/안내용 */
  const [serverGoldPriceDigits, setServerGoldPriceDigits] = useState<
    string | null
  >(null);
  const [serverSilverPriceDigits, setServerSilverPriceDigits] = useState<
    string | null
  >(null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [goldPriceSaving, setGoldPriceSaving] = useState(false);
  const [silverPriceSaving, setSilverPriceSaving] = useState(false);
  const [goldPriceSaveHint, setGoldPriceSaveHint] = useState(false);
  const [silverPriceSaveHint, setSilverPriceSaveHint] = useState(false);
  /**
   * 시세 수동 수정 모드. 평소엔 input 잠금(한국금시세 자동 갱신 그대로 받음),
   * 관리자가 "수정" 클릭 시 input 편집 + 한국금시세 자동 갱신 일시 정지.
   * "저장" 또는 "취소"로 종료.
   */
  const [goldPriceEditing, setGoldPriceEditing] = useState(false);
  const [silverPriceEditing, setSilverPriceEditing] = useState(false);
  /**
   * loadDailyPurchasePrices 폴링 콜백이 클로저 시점의 editing 상태를 모르도록,
   * ref로 최신 값을 들고 다닌다.
   */
  const goldPriceEditingRef = useRef(false);
  const silverPriceEditingRef = useRef(false);
  useEffect(() => {
    goldPriceEditingRef.current = goldPriceEditing;
  }, [goldPriceEditing]);
  useEffect(() => {
    silverPriceEditingRef.current = silverPriceEditing;
  }, [silverPriceEditing]);

  const isAdmin = profile?.role === "admin";
  const staffBranchId = profile?.branch_id ?? null;

  const usesGoldFlow = itemType === "금" || itemType === "치금";
  const isChigum = itemType === "치금";
  const usesSilverFlow = itemType === "은";
  const usesPlatinumFlow = itemType === "백금";
  const usesWeightDonDisplay =
    usesGoldFlow || usesSilverFlow || usesPlatinumFlow;
  const usesMetalPriceRow = usesGoldFlow || usesSilverFlow;

  /** 품목 변경 시 추가 행 초기화(함량·계산식이 달라짐) */
  useEffect(() => {
    setExtraRows([]);
  }, [itemType]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    /** 서버 응답 전 잠깐 보여주는 로컬 캐시값. 진실의 원천은 서버. */
    const gv = localStorage.getItem(LS_GOLD_PRICE);
    if (gv) setGoldPricePerDon(sanitizeWonInputDigits(gv));
    const sv = localStorage.getItem(LS_SILVER_PRICE);
    if (sv) setSilverPricePerDon(sanitizeWonInputDigits(sv));
    const sn = localStorage.getItem(LS_LAST_SELLER_NAME);
    const sp = localStorage.getItem(LS_LAST_SELLER_PHONE);
    if (sn) setSellerName(sn);
    if (sp) setSellerPhone(formatMobileInputDisplay(sp));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (goldPricePerDon.trim()) {
      localStorage.setItem(LS_GOLD_PRICE, goldPricePerDon.trim());
    }
  }, [goldPricePerDon]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (silverPricePerDon.trim()) {
      localStorage.setItem(LS_SILVER_PRICE, silverPricePerDon.trim());
    }
  }, [silverPricePerDon]);

  /**
   * 직전에 서버에서 본 값 — 사용자가 입력칸을 손대지 않았다(현재값 === 직전 서버값)고 판단할 때만
   * 새 서버값으로 입력칸을 자동 교체하기 위한 비교 기준. 입력 중인 값은 절대 덮어쓰지 않는다.
   */
  const prevServerGoldDigitsRef = useRef<string | null>(null);
  const prevServerSilverDigitsRef = useRef<string | null>(null);

  const loadDailyPurchasePrices = useCallback(async () => {
    setPricesLoading(true);
    const ymd = todayYmdSeoul();
    const { data, error } = await supabase
      .from("daily_purchase_prices")
      .select("quote_scope, price_per_don")
      .eq("quote_date", ymd);
    setPricesLoading(false);
    if (error) {
      if (isMissingDailyPriceTableError(error)) {
        setError(
          "오늘의 매입시세를 서버와 공유하려면 Supabase에서 supabase/migration_daily_purchase_prices.sql 을 실행하세요.",
        );
      } else {
        console.error("loadDailyPurchasePrices", error);
      }
      return;
    }
    let goldDigits: string | null = null;
    let silverDigits: string | null = null;
    for (const row of data ?? []) {
      const n = Number(row.price_per_don);
      if (!Number.isFinite(n) || n < 0) continue;
      const digits = sanitizeWonInputDigits(String(Math.round(n)));
      if (row.quote_scope === DAILY_PURCHASE_PRICE_SCOPE_GOLD) goldDigits = digits;
      else if (row.quote_scope === DAILY_PURCHASE_PRICE_SCOPE_SILVER) silverDigits = digits;
    }
    setServerGoldPriceDigits(goldDigits);
    setServerSilverPriceDigits(silverDigits);
    if (goldDigits != null && !goldPriceEditingRef.current) {
      const prev = prevServerGoldDigitsRef.current;
      setGoldPricePerDon((current) => {
        // 첫 서버 응답: localStorage 임시 캐시는 무시하고 서버값(한국금시세 자동값)으로 즉시 교체.
        // 그 뒤로는 사용자가 입력칸을 손대지 않은 경우(빈칸·직전 서버값과 일치)에만 자동 갱신.
        // 관리자가 "수정" 모드면 위 if 가드로 이 블록 자체를 skip.
        if (prev == null) return goldDigits as string;
        const trimmed = current.trim();
        if (trimmed === "" || current === prev) return goldDigits as string;
        return current;
      });
    }
    if (silverDigits != null && !silverPriceEditingRef.current) {
      const prev = prevServerSilverDigitsRef.current;
      setSilverPricePerDon((current) => {
        if (prev == null) return silverDigits as string;
        const trimmed = current.trim();
        if (trimmed === "" || current === prev) return silverDigits as string;
        return current;
      });
    }
    prevServerGoldDigitsRef.current = goldDigits;
    prevServerSilverDigitsRef.current = silverDigits;
  }, [supabase]);

  useEffect(() => {
    if (pathname !== "/purchases") return;
    void loadDailyPurchasePrices();
    // 한국금시세 → daily_purchase_prices 자동 저장을 페이지에서도 따라오게 60초 폴링.
    // 입력 중인 값은 가드(`current === prev`) 로 보호되므로 사용자 입력을 방해하지 않는다.
    const id = window.setInterval(() => {
      void loadDailyPurchasePrices();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [pathname, loadDailyPurchasePrices]);

  const saveDailyPurchasePrice = useCallback(
    async (scope: DailyPurchasePriceScope) => {
      if (!isAdmin) return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("로그인이 필요합니다.");
        return;
      }
      const digits =
        scope === DAILY_PURCHASE_PRICE_SCOPE_GOLD
          ? goldPricePerDon
          : silverPricePerDon;
      const n = parseWonDigitsToNumber(digits);
      if (n == null || !Number.isFinite(n) || n < 0) {
        setError("매입시세는 0 이상의 숫자로 입력하세요.");
        return;
      }
      const isGold = scope === DAILY_PURCHASE_PRICE_SCOPE_GOLD;
      if (isGold) setGoldPriceSaving(true);
      else setSilverPriceSaving(true);
      setError(null);
      const ymd = todayYmdSeoul();
      const { error: upErr } = await supabase
        .from("daily_purchase_prices")
        .upsert(
          {
            quote_date: ymd,
            quote_scope: scope,
            price_per_don: Math.floor(n),
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "quote_date,quote_scope" },
        );
      if (isGold) setGoldPriceSaving(false);
      else setSilverPriceSaving(false);
      if (upErr) {
        if (isMissingDailyPriceTableError(upErr)) {
          setError(
            "오늘의 매입시세를 저장하려면 Supabase에서 supabase/migration_daily_purchase_prices.sql 을 실행하세요.",
          );
        } else {
          setError(upErr.message || "매입시세를 저장하지 못했습니다.");
        }
        return;
      }
      const savedDigits = sanitizeWonInputDigits(String(Math.floor(n)));
      if (isGold) {
        setServerGoldPriceDigits(savedDigits);
        prevServerGoldDigitsRef.current = savedDigits;
        setGoldPricePerDon(savedDigits);
        setGoldPriceEditing(false);
        setGoldPriceSaveHint(true);
        if (typeof window !== "undefined") {
          window.setTimeout(() => setGoldPriceSaveHint(false), 2000);
        }
      } else {
        setServerSilverPriceDigits(savedDigits);
        prevServerSilverDigitsRef.current = savedDigits;
        setSilverPricePerDon(savedDigits);
        setSilverPriceEditing(false);
        setSilverPriceSaveHint(true);
        if (typeof window !== "undefined") {
          window.setTimeout(() => setSilverPriceSaveHint(false), 2000);
        }
      }
    },
    [isAdmin, goldPricePerDon, silverPricePerDon, supabase],
  );

  /** 시세 수정 시작/취소 헬퍼 (관리자 전용) */
  const startEditPrice = useCallback(
    (scope: DailyPurchasePriceScope) => {
      if (!isAdmin) return;
      if (scope === DAILY_PURCHASE_PRICE_SCOPE_GOLD) {
        setGoldPriceEditing(true);
      } else {
        setSilverPriceEditing(true);
      }
    },
    [isAdmin],
  );

  const cancelEditPrice = useCallback(
    (scope: DailyPurchasePriceScope) => {
      if (scope === DAILY_PURCHASE_PRICE_SCOPE_GOLD) {
        const restore = serverGoldPriceDigits;
        if (restore != null) setGoldPricePerDon(restore);
        setGoldPriceEditing(false);
      } else {
        const restore = serverSilverPriceDigits;
        if (restore != null) setSilverPricePerDon(restore);
        setSilverPriceEditing(false);
      }
    },
    [serverGoldPriceDigits, serverSilverPriceDigits],
  );

  useEffect(() => {
    if (isChigum) {
      if (feeTier === "none") setFeeTier("c");
      return;
    }
    if (is24KFamilyNoFee(karat)) {
      setFeeTier("none");
    } else if (feeTier === "none") {
      setFeeTier("b");
    }
  }, [isChigum, karat, feeTier]);

  const goldCalc = useMemo(() => {
    if (!usesGoldFlow) return null;
    const w = parseFloat(weightG.replace(",", "."));
    const p = parseWonDigitsToNumber(goldPricePerDon) ?? NaN;
    const pureGOverride =
      !isChigum && isForeignGoldKarat(karat)
        ? parseForeignPureGoldGInput(foreignPureGoldG)
        : null;
    if (isChigum) {
      const tier: FeeTier =
        feeTier === "a" || feeTier === "b" || feeTier === "c" ? feeTier : "c";
      return calculateGoldPurchase({
        pricePerDon: p,
        weightG: w,
        karat,
        feeTier: tier,
        chigum: true,
      });
    }
    const tier: FeeTier = is24KFamilyNoFee(karat) ? "none" : feeTier;
    return calculateGoldPurchase({
      pricePerDon: p,
      weightG: w,
      karat,
      feeTier: tier,
      pureGoldGOverride: pureGOverride,
    });
  }, [
    usesGoldFlow,
    isChigum,
    weightG,
    goldPricePerDon,
    karat,
    feeTier,
    foreignPureGoldG,
  ]);

  const silverCalc = useMemo(() => {
    if (!usesSilverFlow) return null;
    const w = parseFloat(weightG.replace(",", "."));
    const p = parseWonDigitsToNumber(silverPricePerDon) ?? NaN;
    return calculateSilverPurchase({
      pricePerDon: p,
      weightG: w,
      purity: silverPurity,
    });
  }, [usesSilverFlow, weightG, silverPricePerDon, silverPurity]);

  const weightDonDisplay = useMemo(() => {
    if (!usesWeightDonDisplay) return null;
    const w = parseFloat(weightG.replace(",", "."));
    if (!Number.isFinite(w)) return null;
    if (usesGoldFlow && !isChigum && isForeignGoldKarat(karat)) {
      const pureG = parseForeignPureGoldGInput(foreignPureGoldG);
      if (pureG == null) return null;
      return ledgerDisplayDonFromWeightG(pureG);
    }
    const wEff =
      usesGoldFlow && !isChigum
        ? effectiveWeightGForGoldPurchase(karat, w)
        : w;
    return ledgerDisplayDonFromWeightG(wEff);
  }, [
    usesWeightDonDisplay,
    weightG,
    usesGoldFlow,
    isChigum,
    karat,
    foreignPureGoldG,
  ]);

  const branchLabelMap = useMemo(() => branchLabelsById(branches), [branches]);

  useEffect(() => {
    if (!usesGoldFlow || !goldCalc) return;
    setTotalAmount(String(floorWonTo1000(goldCalc.finalAmount)));
  }, [usesGoldFlow, goldCalc]);

  useEffect(() => {
    if (!usesSilverFlow || !silverCalc) return;
    setTotalAmount(String(floorWonTo1000(silverCalc.amount)));
  }, [usesSilverFlow, silverCalc]);

  /**
   * 추가 행의 자동 계산용 시그니처. totalAmount는 의도적으로 제외해서,
   * 사용자가 totalAmount를 손대도 useEffect가 재실행으로 덮어쓰지 않도록 한다.
   * (첫 행의 goldCalc/silverCalc useMemo와 동일한 의도.)
   */
  const extraCalcSignature = useMemo(() => {
    return extraRows
      .map(
        (r) =>
          `${r.rid}|${r.itemType}|${r.weightG}|${r.foreignPureGoldG}|${r.karat}|${r.feeTier}|${r.silverPurity}`,
      )
      .join("||");
  }, [extraRows]);

  /** 첫 행 + 추가 행 매입금액 합계. 줄 추가 시 고객에게 줘야 할 총액. */
  const purchaseTotalSumWon = useMemo(() => {
    const first = parseWonDigitsToNumber(totalAmount);
    let sum =
      first != null && Number.isFinite(first) && first > 0 ? first : 0;
    for (const r of extraRows) {
      const a = parseWonDigitsToNumber(r.totalAmount);
      if (a != null && Number.isFinite(a) && a > 0) sum += a;
    }
    return sum;
  }, [totalAmount, extraRows]);

  /**
   * 추가 행 함량 변경 시 feeTier 자동 보정
   *  - 24K 계열 → "none"
   *  - 합금/치금이면서 feeTier가 "none"인 경우 → b
   *  - 함량 미선택은 그대로(어차피 select는 disabled).
   * (첫 행의 useEffect와 같은 의도.)
   */
  useEffect(() => {
    setExtraRows((rs) => {
      let changed = false;
      const next = rs.map((r) => {
        const f = purchaseFlowFlags(r.itemType);
        if (!f.usesGoldFlow) return r;
        if (f.isChigum) {
          if (r.feeTier === "none" || r.feeTier == null) {
            changed = true;
            return { ...r, feeTier: "b" as FeeTier };
          }
          return r;
        }
        if (!r.karat) return r;
        if (is24KFamilyNoFee(r.karat)) {
          if (r.feeTier !== "none") {
            changed = true;
            return { ...r, feeTier: "none" as FeeTier };
          }
          return r;
        }
        if (r.feeTier === "none") {
          changed = true;
          return { ...r, feeTier: "b" as FeeTier };
        }
        return r;
      });
      return changed ? next : rs;
    });
  }, [extraCalcSignature]);

  /** 추가 행 자동 계산 — 금/치금 (행별 품목 기준) */
  useEffect(() => {
    const pDon = parseWonDigitsToNumber(goldPricePerDon) ?? NaN;
    if (!Number.isFinite(pDon) || pDon < 0) return;
    setExtraRows((rs) => {
      let changed = false;
      const next = rs.map((r) => {
        if (r.totalAmountUserEdited) return r;
        const f = purchaseFlowFlags(r.itemType);
        if (!f.usesGoldFlow) return r;
        if (!r.karat) return r;
        const w = parseFloat(r.weightG.replace(",", "."));
        if (!Number.isFinite(w) || w <= 0) return r;
        const tier: FeeTier = f.isChigum
          ? r.feeTier === "a" || r.feeTier === "b" || r.feeTier === "c"
            ? r.feeTier
            : "c"
          : is24KFamilyNoFee(r.karat)
            ? "none"
            : r.feeTier;
        const pureGOverride =
          !f.isChigum && isForeignGoldKarat(r.karat)
            ? parseForeignPureGoldGInput(r.foreignPureGoldG)
            : null;
        const calc = calculateGoldPurchase({
          pricePerDon: pDon,
          weightG: w,
          karat: r.karat as GoldKaratSelection,
          feeTier: tier,
          chigum: f.isChigum,
          pureGoldGOverride: pureGOverride,
        });
        if (!calc) return r;
        const newTotal = String(floorWonTo1000(calc.finalAmount));
        if (newTotal === r.totalAmount) return r;
        changed = true;
        return { ...r, totalAmount: newTotal };
      });
      return changed ? next : rs;
    });
    // extraCalcSignature로 totalAmount 외 변경만 트리거
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goldPricePerDon, extraCalcSignature]);

  /** 추가 행 자동 계산 — 은 (행별 품목 기준) */
  useEffect(() => {
    const pDon = parseWonDigitsToNumber(silverPricePerDon) ?? NaN;
    if (!Number.isFinite(pDon) || pDon < 0) return;
    setExtraRows((rs) => {
      let changed = false;
      const next = rs.map((r) => {
        if (r.totalAmountUserEdited) return r;
        const f = purchaseFlowFlags(r.itemType);
        if (!f.usesSilverFlow) return r;
        const w = parseFloat(r.weightG.replace(",", "."));
        if (!Number.isFinite(w) || w <= 0) return r;
        const calc = calculateSilverPurchase({
          pricePerDon: pDon,
          weightG: w,
          purity: r.silverPurity,
        });
        if (!calc) return r;
        const newTotal = String(floorWonTo1000(calc.amount));
        if (newTotal === r.totalAmount) return r;
        changed = true;
        return { ...r, totalAmount: newTotal };
      });
      return changed ? next : rs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silverPricePerDon, extraCalcSignature]);

  const buildCustomerDisplayPayload = useCallback((): CustomerDisplayPayload => {
    /** 첫 행 라인. 치금은 고객에게 함량 종류(크라운/인레이)를 숨기고 "치금"으로만 표시. */
    const firstPurityLabel = isChigum
      ? "치금"
      : usesSilverFlow
        ? silverPurity
        : usesGoldFlow
          ? karat || "—"
          : usesPlatinumFlow
            ? "백금"
            : purity.trim() || "—";
    const firstW = weightG.trim();
    const firstDon =
      weightDonDisplay != null && Number.isFinite(weightDonDisplay)
        ? String(weightDonDisplay)
        : null;
    const firstAmtRaw = parseWonDigitsToNumber(totalAmount);
    const firstAmt =
      firstAmtRaw != null && Number.isFinite(firstAmtRaw) && firstAmtRaw > 0
        ? Math.round(firstAmtRaw)
        : null;
    const firstLine: CustomerDisplayLine = {
      purityLabel: firstPurityLabel,
      weightG: firstW || null,
      weightDon: firstDon,
      amountWon: firstAmt,
    };

    /** 추가 행 라인들 — 매입 등록 폼과 같은 로직으로 함량·돈수 라벨 산출 */
    const extraLines: CustomerDisplayLine[] = extraRows.map((r) => {
      const f = purchaseFlowFlags(r.itemType);
      const purityLabel = f.isChigum
        ? "치금"
        : f.usesSilverFlow
          ? r.silverPurity
          : f.usesGoldFlow
            ? r.karat || "—"
            : f.usesPlatinumFlow
              ? "백금"
              : r.purity.trim() || "—";
      const w = r.weightG.trim();
      const wNum = w ? parseFloat(w.replace(",", ".")) : NaN;
      let don: string | null = null;
      if (f.usesWeightDonDisplay && Number.isFinite(wNum) && wNum > 0) {
        const wEff =
          f.usesGoldFlow && !f.isChigum && r.karat
            ? effectiveWeightGForGoldPurchase(r.karat, wNum)
            : wNum;
        const d = ledgerDisplayDonFromWeightG(wEff);
        if (Number.isFinite(d)) don = String(d);
      }
      const amtRaw = parseWonDigitsToNumber(r.totalAmount);
      const amt =
        amtRaw != null && Number.isFinite(amtRaw) && amtRaw > 0
          ? Math.round(amtRaw)
          : null;
      return {
        purityLabel,
        weightG: w || null,
        weightDon: don,
        amountWon: amt,
      };
    });

    const allLines: CustomerDisplayLine[] = [firstLine, ...extraLines];
    const totalWon = allLines.reduce(
      (sum, l) => sum + (l.amountWon != null ? l.amountWon : 0),
      0,
    );

    return {
      itemType,
      purityLabel: firstPurityLabel,
      weightG: firstW || null,
      weightDon: firstDon,
      amountWon: firstAmt,
      lines: allLines,
      totalWon: totalWon > 0 ? totalWon : null,
    };
  }, [
    itemType,
    usesSilverFlow,
    usesGoldFlow,
    usesWeightDonDisplay,
    isChigum,
    silverPurity,
    karat,
    purity,
    weightG,
    weightDonDisplay,
    totalAmount,
    extraRows,
  ]);

  useEffect(() => {
    if (pathname !== "/purchases") return;
    const branchName = branchId
      ? branchLabelForId(branches, branchId)
      : undefined;
    const ping = () => {
      postCustomerDisplayMessage({
        type: "heartbeat",
        branchName: branchName || undefined,
        at: Date.now(),
      });
    };
    ping();
    const id = setInterval(ping, 5000);
    return () => clearInterval(id);
  }, [pathname, branchId, branches]);

  useEffect(() => {
    if (pathname !== "/purchases") return;
    const t = setTimeout(() => {
      const payload = buildCustomerDisplayPayload();
      if (isCustomerDisplayPayloadEmpty(payload)) {
        postCustomerDisplayMessage({ type: "idle", at: Date.now() });
      } else {
        postCustomerDisplayMessage({
          type: "draft",
          payload,
          at: Date.now(),
        });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [pathname, buildCustomerDisplayPayload]);

  const load = useCallback(async () => {
    setLoading(true);
    setUpdating(false);
    setError(null);
    // NOTE: profile/branches are provided by AppLayout (server) for fast tab switches.
    setProfile(bootstrap.profile);
    setBranches(bootstrap.branches);

    const fromIso = new Date(`${fromDate}T00:00:00`).toISOString();
    const toIso = new Date(`${toDate}T23:59:59.999`).toISOString();

    const cacheKey = `purchases|${fromDate}|${toDate}|branch:${branchId || "all"}`;
    if (purchases.length > 0) setLoading(false);

    await swrLoad<{ purchases: Purchase[] }>({
      key: cacheKey,
      ttlMs: 60_000,
      fetcher: async () => {
        const { data: pu, error: pue } = await supabase
          .from("purchases")
          .select("*, branches(name)")
          .gte("purchased_at", fromIso)
          .lte("purchased_at", toIso)
          .order("purchased_at", { ascending: false });
        if (pue) throw new Error(pue.message);
        return { purchases: (pu ?? []) as Purchase[] };
      },
      onHit: (cached) => {
        setPurchases(cached.purchases);
        setLoading(false);
        setUpdating(true);
      },
      onFresh: ({ purchases: list }) => {
        setPurchases(list);
        setUpdating(false);
        setLoading(false);
      },
      onError: (e) => {
        setUpdating(false);
        setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
        setLoading(false);
      },
    });
  }, [supabase, fromDate, toDate, branchId, bootstrap, purchases.length]);

  useEffect(() => {
    if (pathname !== "/purchases") return;
    void load();
  }, [pathname, load]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && pathname === "/purchases") {
        void load();
        void loadDailyPurchasePrices();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, loadDailyPurchasePrices, pathname]);

  useEffect(() => {
    if (!profile || branches.length === 0) return;
    const shop = branchesForShopSelect(branches);
    if (isAdmin) {
      if (!branchId || !shop.some((b) => b.id === branchId)) {
        setBranchId(firstShopSelectableBranchId(branches));
      }
    } else if (staffBranchId) {
      setBranchId(staffBranchId);
    }
  }, [profile, branches, isAdmin, staffBranchId, branchId]);

  const summary = useMemo(() => {
    const count = purchases.length;
    const sum = purchases.reduce((a, p) => a + Number(p.total_amount), 0);
    return { count, sum };
  }, [purchases]);

  const purchasesLedgerRows = useMemo(() => {
    const ymdToday = todayYmdSeoul();
    const q = purchaseLedgerSearch.trim();
    /**
     * 검색어가 있고 DB 전체 검색 결과를 받았으면 그걸 사용.
     * 검색어가 있지만 아직 로딩 중이면 기존 purchases를 임시로 보여줘
     * 깜빡임을 줄인다.
     */
    let list: Purchase[];
    if (q.length > 0 && purchaseLedgerSearchResults != null) {
      list = [...purchaseLedgerSearchResults];
    } else {
      list = [...purchases];
    }
    if (purchaseLedgerTodayOnly) {
      list = list.filter(
        (p) => seoulYmdFromIso(p.purchased_at) === ymdToday,
      );
    }
    if (q.length > 0) {
      list = list.filter((p) =>
        matchesLedgerCustomerSearch(
          q,
          p.seller_name,
          p.seller_phone,
          undefined,
          purchaseLedgerSearchExtraTerms(p),
        ),
      );
    }
    list.sort((a, b) => {
      const ta = new Date(a.purchased_at).getTime();
      const tb = new Date(b.purchased_at).getTime();
      return purchaseLedgerDateSortAsc ? ta - tb : tb - ta;
    });
    return list;
  }, [
    purchases,
    purchaseLedgerSearchResults,
    purchaseLedgerTodayOnly,
    purchaseLedgerDateSortAsc,
    purchaseLedgerSearch,
  ]);

  const purchaseLedgerTableSum = useMemo(
    () =>
      purchasesLedgerRows.reduce((a, p) => a + Number(p.total_amount), 0),
    [purchasesLedgerRows],
  );

  /**
   * 검색어가 있을 때 fromDate/toDate 무시하고 DB 전체에서 고객명·전화·품목·함량·특이사항 매칭.
   * 디바운싱 300ms. 검색어가 비면 결과 캐시 해제하고 기존 조회 기간 데이터로 복귀.
   */
  useEffect(() => {
    if (pathname !== "/purchases") return;
    const q = purchaseLedgerSearch.trim();
    if (q.length === 0) {
      setPurchaseLedgerSearchResults(null);
      setPurchaseLedgerSearchLoading(false);
      return;
    }

    let cancelled = false;
    setPurchaseLedgerSearchLoading(true);

    const handle = setTimeout(async () => {
      // PostgREST .or() 의 구분자가 ',' 라 검색어에 들어오면 쿼리가 깨진다. 안전하게 제거.
      const sanitized = q.replace(/[,()*]/g, " ").trim();
      if (sanitized.length === 0) {
        if (!cancelled) {
          setPurchaseLedgerSearchResults([]);
          setPurchaseLedgerSearchLoading(false);
        }
        return;
      }
      const qDigits = sanitized.replace(/\D+/g, "");
      const orParts = [
        `seller_name.ilike.%${sanitized}%`,
        `seller_phone.ilike.%${sanitized}%`,
        `item_type.ilike.%${sanitized}%`,
        `purity.ilike.%${sanitized}%`,
        `karat.ilike.%${sanitized}%`,
        `note.ilike.%${sanitized}%`,
      ];
      if (qDigits.length > 0 && qDigits !== sanitized) {
        orParts.push(`seller_phone.ilike.%${qDigits}%`);
      }

      let query = supabase
        .from("purchases")
        .select("*, branches(name)")
        .or(orParts.join(","))
        .order("purchased_at", { ascending: false })
        .limit(500);

      const { data, error: se } = await query;
      if (cancelled) return;
      if (se) {
        // 검색 실패 시 조용히 빈 결과 — 사용자는 표 상단 "검색 결과 없음" 으로 확인
        setPurchaseLedgerSearchResults([]);
        setPurchaseLedgerSearchLoading(false);
        return;
      }
      setPurchaseLedgerSearchResults((data ?? []) as Purchase[]);
      setPurchaseLedgerSearchLoading(false);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pathname, purchaseLedgerSearch, supabase]);

  const purchaseLedgerClipboardCopy = useMemo(
    () => ({
      columnHeaders: PURCHASE_LEDGER_CLIPBOARD_HEADERS,
      includeHeaderRow: false,
      omitLeadingDataColumns: 0,
      /** 맨 오른쪽 수정/삭제 버튼 열만 복사 제외 */
      omitTrailingDataColumns: isAdmin ? 2 : 1,
    }),
    [isAdmin],
  );

  /** 아래 장부·선택 매장 기준 가장 최근 고객(치금 제외, 이름 또는 전화 있음) */
  const recentSellerFromPurchases = useMemo(() => {
    if (!branchId) return null;
    const sorted = [...purchases]
      .filter((p) => p.branch_id === branchId)
      .sort(
        (a, b) =>
          new Date(b.purchased_at).getTime() -
          new Date(a.purchased_at).getTime(),
      );
    for (const p of sorted) {
      if (p.item_type === "치금") continue;
      const name = (p.seller_name ?? "").trim();
      const phone = (p.seller_phone ?? "").trim();
      if (name || phone) return { name, phone };
    }
    return null;
  }, [purchases, branchId]);

  const hasPrevSeller = recentSellerFromPurchases != null;

  function applySuggestedTotalNonGold() {
    const w = parseFloat(weightG.replace(",", "."));
    const u = parseFloat(unitPrice.replace(/,/g, ""));
    if (!Number.isFinite(w) || !Number.isFinite(u)) return;
    setTotalAmount(String(floorWonTo1000(w * u)));
  }

  /** 매입금액(원)란: 천 원 미만 절사(내림). 포커스 아웃 시에도 동일 */
  function snapPurchaseAmountInputTo1000Won() {
    const n = parseWonDigitsToNumber(totalAmount);
    if (n == null || !Number.isFinite(n)) return;
    const f = floorWonTo1000(n);
    if (f !== n) setTotalAmount(String(f));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId) {
      setError("매장(지점) 정보를 불러오지 못했습니다. 잠시 후 새로고침 해 보세요.");
      return;
    }
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    const purchasedAtIso = new Date().toISOString();
    const quoteYmd = localYmdFromIso(purchasedAtIso);

    /** 처리시세(금/은) 1회만 조회해 모든 행에서 재사용 */
    let cachedGoldProcDon: number | null | undefined = undefined;
    let cachedSilverProcDon: number | null | undefined = undefined;
    const getGoldProcDon = async (): Promise<number | null> => {
      if (cachedGoldProcDon !== undefined) return cachedGoldProcDon;
      const { data: q, error: qErr } = await supabase
        .from("jongro_daily_quotes")
        .select("price_per_don")
        .eq("branch_id", branchId)
        .eq("quote_date", quoteYmd)
        .eq("quote_scope", JONGRO_QUOTE_SCOPE_GOLD)
        .maybeSingle();
      if (
        qErr ||
        q == null ||
        q.price_per_don == null ||
        !Number.isFinite(Number(q.price_per_don))
      ) {
        cachedGoldProcDon = null;
        return null;
      }
      cachedGoldProcDon = Number(q.price_per_don);
      return cachedGoldProcDon;
    };
    const getSilverProcDon = async (): Promise<number | null> => {
      if (cachedSilverProcDon !== undefined) return cachedSilverProcDon;
      const { data: q, error: qErr } = await supabase
        .from("jongro_daily_quotes")
        .select("price_per_don")
        .eq("branch_id", branchId)
        .eq("quote_date", quoteYmd)
        .eq("quote_scope", JONGRO_QUOTE_SCOPE_SILVER)
        .maybeSingle();
      if (
        qErr ||
        q == null ||
        q.price_per_don == null ||
        !Number.isFinite(Number(q.price_per_don))
      ) {
        cachedSilverProcDon = null;
        return null;
      }
      cachedSilverProcDon = Number(q.price_per_don);
      return cachedSilverProcDon;
    };

    /** 판매자 전화번호(거래 공통). 치금 행에서는 행 단위로 null 처리한다. */
    const phoneNorm = sellerPhone.trim()
      ? normalizeKoreanMobilePhone(sellerPhone)
      : "";

    /** 첫 행 + 추가 행 통합. karat 빈 문자열 = "선택" 미지정. 품목은 행별. */
    type RowSnap = {
      itemType: string;
      paymentMethod: string;
      weightG: string;
      foreignPureGoldG: string;
      karat: GoldKaratSelection | "";
      feeTier: FeeTier;
      totalAmount: string;
      purity: string;
      unitPrice: string;
      silverPurity: SilverPurity;
    };
    const allRows: RowSnap[] = [
      {
        itemType,
        paymentMethod,
        weightG,
        foreignPureGoldG,
        karat,
        feeTier,
        totalAmount,
        purity,
        unitPrice,
        silverPurity,
      },
      ...extraRows.map((r) => ({
        itemType: r.itemType,
        paymentMethod: r.paymentMethod,
        weightG: r.weightG,
        foreignPureGoldG: r.foreignPureGoldG,
        karat: r.karat,
        feeTier: r.feeTier,
        totalAmount: r.totalAmount,
        purity: r.purity,
        unitPrice: r.unitPrice,
        silverPurity: r.silverPurity,
      })),
    ];

    const rowLabel = (idx: number) =>
      allRows.length === 1
        ? ""
        : `${idx + 1}번째 명세: `;

    const inserts: Record<string, unknown>[] = [];
    /** 고객 대기화면에 보여줄 라인들(저장된 값 기준) */
    const savedLines: CustomerDisplayLine[] = [];
    let savedTotalWon = 0;

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const label = rowLabel(i);
      const rf = purchaseFlowFlags(row.itemType);

      const totalParsed = parseWonDigitsToNumber(row.totalAmount) ?? NaN;
      if (!Number.isFinite(totalParsed)) {
        setError(`${label}매입 금액은 숫자로 입력하세요.`);
        setSaving(false);
        return;
      }
      const total = floorWonTo1000(totalParsed);
      if (totalParsed > 0 && total === 0) {
        setError(
          `${label}매입 금액은 1,000원 단위로만 등록됩니다. 천 원 미만은 입력할 수 없습니다.`,
        );
        setSaving(false);
        return;
      }

      const weightVal = row.weightG.trim()
        ? parseFloat(row.weightG.replace(",", "."))
        : null;

      let purityVal: string | null =
        row.itemType === "은" ? row.silverPurity : row.purity.trim() || null;

      let goldExtra: Record<string, unknown> | null = null;
      let silverExtra: Record<string, unknown> | null = null;

      if (rf.usesGoldFlow) {
        const pDon = parseWonDigitsToNumber(goldPricePerDon) ?? NaN;
        if (
          weightVal == null ||
          !Number.isFinite(weightVal) ||
          weightVal <= 0
        ) {
          setError(`${label}금·치금 매입은 중량(g)을 입력하세요.`);
          setSaving(false);
          return;
        }
        if (!Number.isFinite(pDon) || pDon < 0) {
          setError("오늘의 매입시세(원/돈)를 입력하세요.");
          setSaving(false);
          return;
        }
        if (!row.karat) {
          setError(`${label}함량을 선택하세요.`);
          setSaving(false);
          return;
        }
        const karatRow: GoldKaratSelection = row.karat;
        const tier: FeeTier = rf.isChigum
          ? row.feeTier === "a" || row.feeTier === "b" || row.feeTier === "c"
            ? row.feeTier
            : "c"
          : is24KFamilyNoFee(karatRow)
            ? "none"
            : row.feeTier;
        if (rf.isChigum) {
          if (tier !== "a" && tier !== "b" && tier !== "c") {
            setError(`${label}치금은 매입비 a/b/c를 선택하세요.`);
            setSaving(false);
            return;
          }
        } else if (!is24KFamilyNoFee(karatRow) && tier === "none") {
          setError(`${label}18K·14K·10K는 매입비 등급(a/b/c)을 선택하세요.`);
          setSaving(false);
          return;
        }
        const pureGOverride =
          !rf.isChigum && karatRow === "외국금"
            ? parseForeignPureGoldGInput(row.foreignPureGoldG)
            : null;
        if (!rf.isChigum && karatRow === "외국금" && pureGOverride == null) {
          setError(`${label}외국금은 순금 중량(g)을 입력하세요.`);
          setSaving(false);
          return;
        }
        const calc = calculateGoldPurchase({
          pricePerDon: pDon,
          weightG: weightVal,
          karat: karatRow,
          feeTier: tier,
          chigum: rf.isChigum,
          pureGoldGOverride: pureGOverride,
        });
        if (!calc) {
          setError(`${label}금액 계산에 실패했습니다. 입력값을 확인하세요.`);
          setSaving(false);
          return;
        }
        purityVal = karatRow;
        goldExtra = {
          purity: karatRow,
          unit_price: pDon,
          gold_price_per_don: pDon,
          karat: karatRow,
          purity_factor: (KARAT_FACTORS as Record<string, number>)[karatRow],
          weight_don_raw: calc.weightDonRaw,
          pure_gold_g: calc.pureGoldG,
          pure_gold_don: calc.pureGoldDon,
          fee_tier: tier,
          processing_price_per_don: null,
          margin_amount: null,
        };
        const procDon = await getGoldProcDon();
        if (procDon != null && procDon >= 0) {
          const synthForLedger = {
            item_type: row.itemType,
            weight_g: weightVal,
            purity: karatRow,
            karat: karatRow,
            total_amount: total,
            pure_gold_don: calc.pureGoldDon,
            purity_factor: (KARAT_FACTORS as Record<string, number>)[karatRow],
          } as Purchase;
          const ledgerFields = processingLedgerFieldsForPurchase(
            procDon,
            synthForLedger,
          );
          if (ledgerFields != null) {
            goldExtra.gold_price_per_don = ledgerFields.gold_price_per_don;
            goldExtra.processing_price_per_don =
              ledgerFields.processing_price_per_don;
            goldExtra.margin_amount = ledgerFields.margin_amount;
          }
        }
      } else if (rf.usesSilverFlow) {
        const pDon = parseWonDigitsToNumber(silverPricePerDon) ?? NaN;
        if (
          weightVal == null ||
          !Number.isFinite(weightVal) ||
          weightVal <= 0
        ) {
          setError(`${label}은 매입은 중량(g)을 입력하세요.`);
          setSaving(false);
          return;
        }
        if (!Number.isFinite(pDon) || pDon < 0) {
          setError("오늘의 매입시세(은, 원/돈)를 입력하세요.");
          setSaving(false);
          return;
        }
        const sCalc = calculateSilverPurchase({
          pricePerDon: pDon,
          weightG: weightVal,
          purity: row.silverPurity,
        });
        if (!sCalc) {
          setError(
            `${label}은 매입 금액 계산에 실패했습니다. 입력값을 확인하세요.`,
          );
          setSaving(false);
          return;
        }
        purityVal = row.silverPurity;
        silverExtra = {
          purity: row.silverPurity,
          unit_price: pDon,
          purity_factor: sCalc.mult,
          weight_don_raw: sCalc.rawDon,
          pure_gold_don: sCalc.billableDon,
          karat: null,
          gold_price_per_don: null,
          fee_tier: null,
          processing_price_per_don: null,
          margin_amount: null,
        };
        const sProc = await getSilverProcDon();
        if (sProc != null && sProc >= 0) {
          const sLedger = silverProcessingLedgerFieldsFromQuote(sProc, {
            item_type: row.itemType,
            weight_g: weightVal,
            purity: row.silverPurity,
            total_amount: total,
          });
          if (sLedger != null) {
            silverExtra.gold_price_per_don = sLedger.gold_price_per_don;
            silverExtra.processing_price_per_don =
              sLedger.processing_price_per_don;
            silverExtra.margin_amount = sLedger.margin_amount;
          }
        }
      }

      const insertBase: Record<string, unknown> = {
        branch_id: branchId,
        created_by: user.id,
        purchased_at: purchasedAtIso,
        item_type: row.itemType,
        weight_g: weightVal,
        total_amount: total,
        payment_method: row.paymentMethod || null,
        note: note.trim() || null,
        seller_name: rf.isChigum ? null : sellerName.trim() || null,
        seller_phone: rf.isChigum ? null : phoneNorm.trim() || null,
      };

      if (goldExtra) {
        Object.assign(insertBase, goldExtra);
      } else if (silverExtra) {
        Object.assign(insertBase, silverExtra);
      } else {
        const unitVal = row.unitPrice.trim()
          ? parseFloat(row.unitPrice.replace(/,/g, ""))
          : null;
        insertBase.purity = purityVal;
        insertBase.unit_price = unitVal;
      }

      inserts.push(insertBase);

      const linePurityLabel = rf.isChigum
        ? "치금"
        : rf.usesSilverFlow
          ? row.silverPurity
          : rf.usesGoldFlow
            ? row.karat || "—"
            : rf.usesPlatinumFlow
              ? "백금"
              : row.purity.trim() || "—";
      const lineWeightStr = row.weightG.trim() || null;
      let lineDon: string | null = null;
      if (
        rf.usesWeightDonDisplay &&
        weightVal != null &&
        Number.isFinite(weightVal) &&
        weightVal > 0
      ) {
        const wEff =
          rf.usesGoldFlow && !rf.isChigum && row.karat
            ? effectiveWeightGForGoldPurchase(row.karat, weightVal)
            : weightVal;
        const d = ledgerDisplayDonFromWeightG(wEff);
        if (Number.isFinite(d)) lineDon = String(d);
      }
      savedLines.push({
        purityLabel: linePurityLabel,
        weightG: lineWeightStr,
        weightDon: lineDon,
        amountWon: total > 0 ? total : null,
      });
      savedTotalWon += total;
    }

    const { error: ie } = await supabase.from("purchases").insert(inserts);

    if (ie) {
      setError(
        ie.message.includes("column") || ie.code === "PGRST204"
          ? `${ie.message} — Supabase에서 migration_purchase_gold.sql · migration_purchase_audit.sql 을 실행했는지 확인하세요.`
          : ie.message,
      );
      setSaving(false);
      return;
    }

    const savedName = !isChigum ? sellerName.trim() : "";
    const savedPhone = !isChigum ? sellerPhone.trim() : "";

    const firstSavedLine = savedLines[0];
    const savedPayload: CustomerDisplayPayload = {
      itemType,
      purityLabel: firstSavedLine?.purityLabel ?? "—",
      weightG: firstSavedLine?.weightG ?? null,
      weightDon: firstSavedLine?.weightDon ?? null,
      amountWon: firstSavedLine?.amountWon ?? null,
      lines: savedLines,
      totalWon: savedTotalWon > 0 ? savedTotalWon : null,
    };
    postCustomerDisplayMessage({
      type: "saved",
      payload: savedPayload,
      at: Date.now(),
    });

    setSellerName("");
    setSellerPhone("");
    if (typeof window !== "undefined") {
      localStorage.removeItem(LS_LAST_SELLER_NAME);
      localStorage.removeItem(LS_LAST_SELLER_PHONE);
    }

    if (reusePrevSeller && !isChigum && (savedName || savedPhone)) {
      setSellerName(savedName);
      setSellerPhone(
        savedPhone ? formatMobileInputDisplay(savedPhone) : "",
      );
    }

    setNote("");
    setWeightG("");
    setForeignPureGoldG("");
    setPurity("");
    setSilverPurity(SILVER_PURITIES[0]);
    setUnitPrice("");
    setTotalAmount("");
    setExtraRows([]);
    await load();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("이 매입 기록을 삭제할까요?")) return;
    const { error: de } = await supabase.from("purchases").delete().eq("id", id);
    if (de) {
      setError(de.message);
      return;
    }
    await load();
  }

  const staffNeedsBranch = !isAdmin && !staffBranchId;
  const shopBranches = useMemo(
    () => branchesForShopSelect(branches),
    [branches],
  );

  const enterOrder = useMemo(() => {
    const customerBeforeWeight = !isChigum
      ? (["reusePrevSeller", "sellerName", "sellerPhone"] as const)
      : (["sellerName", "sellerPhone"] as const);
    if (usesGoldFlow) {
      const tail =
        itemType === "치금"
          ? ([
              "itemType",
              "weightG",
              "karat",
              "feeTier",
              "totalAmount",
              "paymentMethod",
              "note",
              "submitBtn",
            ] as const)
          : ([
              "itemType",
              ...customerBeforeWeight,
              "weightG",
              "karat",
              "feeTier",
              "totalAmount",
              "paymentMethod",
              "note",
              "submitBtn",
            ] as const);
      return ["goldPrice", ...tail];
    }
    if (usesSilverFlow) {
      const tail = [
        "itemType",
        ...customerBeforeWeight,
        "weightG",
        "silverPurity",
        "totalAmount",
        "paymentMethod",
        "note",
        "submitBtn",
      ] as const;
      return ["silverPrice", ...tail];
    }
    const tail = [
      "itemType",
      ...customerBeforeWeight,
      "weightG",
      "purity",
      "unitPrice",
      "totalAmount",
      "paymentMethod",
      "note",
      "submitBtn",
    ] as const;
    return [...tail];
  }, [usesGoldFlow, usesSilverFlow, itemType, isChigum]);

  const { reg, onKeyDown } = useEnterAdvance(enterOrder);

  const tableColSpan = isAdmin ? 15 : 14;

  /** 매입등록: 라벨 상단 정렬 + 입력 높이 통일 + 모든 칸 가운데 정렬(가로 한 줄 폼) */
  const regField = "flex min-w-0 flex-col gap-1";
  const regLabel = "toss-form-label text-center";
  const regInput =
    "toss-input h-9 w-full px-2 text-sm leading-none text-center";
  const regInputNum = `${regInput} tabular-nums`;
  const regSelect = `${regInput} text-center`;
  const regRead =
    "toss-input flex h-9 w-full items-center justify-center bg-[var(--surface-subtle)] px-2 text-sm tabular-nums text-[var(--foreground)] text-center";
  const regInputDis =
    `${regInput} disabled:cursor-not-allowed disabled:opacity-70 disabled:bg-gray-100 dark:disabled:bg-gray-800/80`;
  /** 특이사항 — 좁은 열에서 placeholder·입력이 잘리지 않게 */
  const regInputNote =
    `${regInput} px-1.5 text-xs leading-tight placeholder:text-[10px] placeholder:leading-tight`;

  /** 헤더 매입시세 행 — 수정 모드 입력 */
  const headerPriceChip =
    "toss-btn-sm disabled:opacity-50";

  /** lg+ 매입등록 입력 그리드 — 카드 전체 너비 (10열, 오른쪽 삭제 버튼 여백 항상 확보) */
  const purchaseFormGridCols =
    "lg:grid-cols-[minmax(2.75rem,0.55fr)_minmax(3.75rem,0.95fr)_minmax(6rem,1.25fr)_minmax(3rem,0.65fr)_minmax(2.5rem,0.55fr)_minmax(3.5rem,0.75fr)_minmax(2.5rem,0.55fr)_minmax(5.5rem,1.05fr)_minmax(2.75rem,0.6fr)_minmax(4rem,1fr)]";
  const purchaseRowSidePad = "lg:pr-9";

  const purchaseTotalSumCard =
    extraRows.length > 0 ? (
      <div className="inline-flex shrink-0 items-center gap-2 toss-chip-sum px-2.5 py-1">
        <span className="whitespace-nowrap text-[10px] font-semibold text-[var(--muted)]">
          총 매입금액
          <span className="ml-0.5 font-normal text-[var(--muted)]">
            ({extraRows.length + 1}건)
          </span>
        </span>
        <span className="whitespace-nowrap text-sm font-bold tabular-nums tracking-tight text-[var(--foreground)]">
          {formatKRW(floorWonTo1000(purchaseTotalSumWon))}
        </span>
      </div>
    ) : null;

  const purchaseFormHintTooltip =
    !isChigum ||
    (usesGoldFlow && isChigum) ||
    (usesGoldFlow && !isChigum && isAdmin) ||
    usesSilverFlow ? (
      <div className="space-y-1.5 text-left">
        <ul className="list-inside list-disc space-y-1">
          {!isChigum ? (
            <li>
              저장 후 고객란 초기화 ·{" "}
              <strong className="font-medium">직전거래</strong>
              는 이 매장 최근 고객(치금 제외)
            </li>
          ) : null}
          {usesGoldFlow && isChigum ? (
            <li>
              치금 매입비 a/b/c 등급 선택
              {isAdmin ? " · 관리자: a30%·b25%·c20%" : ""}
            </li>
          ) : null}
          {usesGoldFlow && !isChigum && isAdmin ? (
            <li>
              순금(24K·24K-1·외국금) 매입비 없음 · 24K-1 돈당 −
              {ANALYSIS_FEE_PER_DON_24K1.toLocaleString("ko-KR")}원 · 합금 기본 b ·
              10K 돈수×0.4 · a95%·b90%·c85%
            </li>
          ) : null}
          {usesSilverFlow ? (
            <li>은: 함량 배율 반영 돈수 × 은 시세</li>
          ) : null}
        </ul>
      </div>
    ) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-3 sm:px-4 lg:px-5">
      {staffNeedsBranch ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          소속 매장이 없습니다. (직원 모드) 관리자에게 지점을 배정해 달라고 하세요.
        </div>
      ) : null}

      {error ? (
        <div className="toss-alert-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <RegistrationPageHeader
        title="매입등록"
        description={
          <>
            금·은·치금·백금 매입을 등록합니다. 품목별 시세·중량·매입금액을 입력해 저장하면
            아래 매입내역에 반영됩니다.
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => {
              const url = `${window.location.origin}/customer-display`;
              window.open(
                url,
                "goldLedgerCustomerDisplay",
                "noopener,noreferrer",
              );
            }}
            className="toss-btn-secondary toss-btn-sm shrink-0 px-2.5"
            title="둘째 모니터 · /customer-display · F11 풀스크린 후 상시 표시"
          >
            고객 화면
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[7fr_3fr] lg:items-stretch lg:gap-5">
      <section className="relative flex min-h-0 min-w-0 flex-col purchase-ledger-work-card p-4 lg:p-5">
        {usesMetalPriceRow ? (
          <div className="grid grid-cols-1 gap-3 border-b border-[var(--border)] py-3 lg:grid-cols-[1fr_auto_1fr] lg:items-start lg:gap-4">
            <div className="min-w-0 text-left">
              {(() => {
                const editing = usesGoldFlow
                  ? goldPriceEditing
                  : silverPriceEditing;
                const saving = usesGoldFlow
                  ? goldPriceSaving
                  : silverPriceSaving;
                const scope = usesGoldFlow
                  ? DAILY_PURCHASE_PRICE_SCOPE_GOLD
                  : DAILY_PURCHASE_PRICE_SCOPE_SILVER;
                const editable = isAdmin && editing;
                const priceDigits = usesGoldFlow
                  ? goldPricePerDon
                  : silverPricePerDon;
                const priceUnitSuffix = usesGoldFlow
                  ? "(원/돈·24K)"
                  : "(원/돈·은)";
                const priceDesc = usesGoldFlow
                  ? `금 · 한국금시세+2,000원 자동${isAdmin ? " · 수정 가능" : " · 조회만"}`
                  : `은 · 서버 저장 시세${isAdmin ? " · 수정 가능" : " · 조회만"}`;
                const saveHint = usesGoldFlow
                  ? goldPriceSaveHint
                  : silverPriceSaveHint;
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span className="text-sm font-medium leading-snug text-[var(--foreground)]">
                        오늘의 매입시세
                      </span>
                      <span className="text-sm font-medium leading-snug text-[var(--muted)]">
                        {priceUnitSuffix}
                      </span>
                      {isAdmin ? (
                        editing ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void saveDailyPurchasePrice(scope)}
                              disabled={saving || pricesLoading}
                              className={`${headerPriceChip} toss-btn-primary shrink-0`}
                            >
                              {saving ? "저장 중…" : "저장"}
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelEditPrice(scope)}
                              disabled={saving}
                              className={`${headerPriceChip} toss-btn-secondary shrink-0`}
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditPrice(scope)}
                            disabled={pricesLoading}
                            className={`${headerPriceChip} toss-btn-primary shrink-0`}
                          >
                            수정
                          </button>
                        )
                      ) : null}
                    </div>
                    {editing ? (
                      <input
                        ref={reg(usesGoldFlow ? "goldPrice" : "silverPrice")}
                        onKeyDown={onKeyDown(
                          usesGoldFlow ? "goldPrice" : "silverPrice",
                        )}
                        value={formatWonInputDisplay(priceDigits)}
                        onChange={(e) => {
                          if (!editable) return;
                          const d = sanitizeWonInputDigits(e.target.value);
                          if (usesGoldFlow) setGoldPricePerDon(d);
                          else setSilverPricePerDon(d);
                        }}
                        readOnly={!editable}
                        className="toss-input mt-2 h-11 w-full max-w-[14rem] px-2 text-2xl font-bold tabular-nums leading-none text-[var(--foreground)]"
                        placeholder={pricesLoading ? "불러오는 중…" : "520,000"}
                        inputMode="numeric"
                        autoFocus
                      />
                    ) : (
                      <p className="mt-1.5 text-3xl font-bold tabular-nums leading-none tracking-tight text-[var(--foreground)] sm:text-4xl">
                        {pricesLoading
                          ? "…"
                          : priceDigits.trim()
                            ? formatWonInputDisplay(priceDigits)
                            : "—"}
                      </p>
                    )}
                    <p className="mt-2 text-xs leading-snug text-[var(--muted)]">
                      {priceDesc}
                      {saveHint ? (
                        <span className="text-positive font-medium"> · 저장됨</span>
                      ) : null}
                    </p>
                    {purchaseFormHintTooltip ? (
                      <div className="mt-1.5">
                        <HelpTooltip
                          label="매입등록 도움말"
                          trigger="text"
                        >
                          {purchaseFormHintTooltip}
                        </HelpTooltip>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </div>

            <div className="toss-highlight-panel w-full shrink-0 px-2.5 py-2 lg:w-56 lg:max-w-[14rem] lg:justify-self-center xl:w-64">
              <SellPriceLineupStrip embedded />
            </div>

            {isAdmin ? (
              <div className="toss-highlight-panel w-full shrink-0 px-2.5 py-2 lg:w-56 lg:max-w-[14rem] lg:justify-self-end xl:w-64">
                <PurchaseCalcPreview
                  embedded
                  usesGoldFlow={usesGoldFlow}
                  usesSilverFlow={usesSilverFlow}
                  isChigum={isChigum}
                  karat={karat}
                  weightG={weightG}
                  foreignPureGoldG={foreignPureGoldG}
                  goldPriceDigits={goldPricePerDon}
                  silverPriceDigits={silverPricePerDon}
                  goldCalc={goldCalc}
                  silverCalc={silverCalc}
                />
              </div>
            ) : (
              <div className="hidden lg:block" aria-hidden />
            )}
          </div>
        ) : null}

        <form
          className="flex min-h-0 flex-1 flex-col pt-1 text-left"
          onSubmit={(e) => void handleAdd(e)}
        >
          <div className="w-full space-y-2 px-1 py-1 lg:px-2">
            <div className={`relative hidden ${purchaseRowSidePad} lg:block`}>
              <div
                className={`grid w-full ${purchaseFormGridCols} gap-x-2 text-center text-xs font-semibold leading-tight text-[var(--foreground)]`}
              >
                <span className="truncate">품목</span>
                <span className="truncate">고객명</span>
                <span className="truncate">전화번호</span>
                <span className="truncate">중량(g)</span>
                <span className="truncate">
                  {usesGoldFlow && !isChigum && isForeignGoldKarat(karat)
                    ? "순금(g)"
                    : "돈수"}
                </span>
                <span className="truncate">함량</span>
                <span className="truncate">매입비</span>
                <span className="truncate">매입금액(원)</span>
                <span className="truncate">결제</span>
                <span className="truncate">특이사항</span>
              </div>
            </div>

            <div className={`relative ${purchaseRowSidePad}`}>
            <div
              className={`grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-4 lg:w-full ${purchaseFormGridCols} lg:items-start lg:gap-x-2 lg:gap-y-1`}
            >
              {/* 품목 */}
              <div className={`${regField} lg:gap-0`}>
                <label className={`${regLabel} lg:hidden`}>품목</label>
                <select
                  ref={reg("itemType")}
                  onKeyDown={onKeyDown("itemType")}
                  value={itemType}
                  onChange={(e) => {
                    const v = e.target.value;
                    setItemType(v);
                    if (v === "치금") {
                      setSellerName("");
                      setSellerPhone("");
                      setKarat("크라운");
                      setFeeTier("c");
                    } else {
                      setKarat((prev) =>
                        prev === "크라운" || prev === "인레이" ? "" : prev,
                      );
                    }
                  }}
                  className={regSelect}
                >
                  <option value="금">금</option>
                  <option value="은">은</option>
                  <option value="치금">치금</option>
                  <option value="백금">백금</option>
                  <option value="기타">기타</option>
                </select>
              </div>
              {/* 고객명 */}
              <div className={`${regField} lg:gap-0`}>
                <label className={`${regLabel} lg:hidden`} htmlFor="purchase-seller-name">
                  고객명
                </label>
                <input
                  id="purchase-seller-name"
                  ref={reg("sellerName")}
                  onKeyDown={onKeyDown("sellerName")}
                  value={isChigum ? "" : sellerName}
                  onChange={(e) => setSellerName(e.target.value)}
                  disabled={isChigum}
                  tabIndex={isChigum ? -1 : undefined}
                  className={regInputDis}
                  placeholder={isChigum ? "치금 생략" : "선택"}
                />
              </div>
              {/* 전화번호 */}
              <div className={`${regField} lg:gap-0`}>
                <label className={`${regLabel} lg:hidden`}>전화번호</label>
                <input
                  ref={reg("sellerPhone")}
                  onKeyDown={onKeyDown("sellerPhone")}
                  value={isChigum ? "" : sellerPhone}
                  onChange={(e) =>
                    setSellerPhone(formatMobileInputDisplay(e.target.value))
                  }
                  disabled={isChigum}
                  tabIndex={isChigum ? -1 : undefined}
                  className={regInputDis}
                  placeholder={isChigum ? "치금 생략" : "0000-0000"}
                  inputMode="tel"
                />
              </div>
              {/* 중량 */}
              <div className={`${regField} lg:gap-0`}>
                <label className={`${regLabel} lg:hidden`}>중량(g)</label>
                <input
                  ref={reg("weightG")}
                  onKeyDown={onKeyDown("weightG")}
                  value={weightG}
                  onChange={(e) => setWeightG(e.target.value)}
                  className={regInputNum}
                  inputMode="decimal"
                />
              </div>
              {/* 순금(g) / 돈수 */}
              <div className={`${regField} lg:gap-0`}>
                <label className={`${regLabel} lg:hidden`}>
                  {usesGoldFlow && !isChigum && isForeignGoldKarat(karat)
                    ? "순금(g)"
                    : "돈수"}
                </label>
                {usesGoldFlow && !isChigum && isForeignGoldKarat(karat) ? (
                  <div className="flex flex-col items-stretch gap-0.5">
                    <input
                      value={foreignPureGoldG}
                      onChange={(e) => setForeignPureGoldG(e.target.value)}
                      className={regInputNum}
                      inputMode="decimal"
                      placeholder="순금 g"
                      title="외국금 순금 중량(g) — 함량마다 다르므로 직접 입력"
                    />
                    <span className="text-center text-[10px] tabular-nums text-[var(--muted)] lg:text-[11px]">
                      {weightDonDisplay != null
                        ? `→ ${weightDonDisplay.toFixed(2)}돈`
                        : "→ —돈"}
                    </span>
                  </div>
                ) : (
                  <div className={regRead}>
                    {usesWeightDonDisplay
                      ? weightDonDisplay != null
                        ? weightDonDisplay.toFixed(2)
                        : "—"
                      : "—"}
                  </div>
                )}
              </div>
              {/* 함량 (품목별 분기) */}
              <div className={`${regField} lg:gap-0`}>
                <label className={`${regLabel} lg:hidden`}>함량</label>
                {usesGoldFlow ? (
                  <select
                    ref={reg("karat")}
                    onKeyDown={onKeyDown("karat")}
                    value={karat}
                    onChange={(e) => {
                      const next = e.target.value as GoldKaratSelection | "";
                      setKarat(next);
                      if (next !== "외국금") setForeignPureGoldG("");
                    }}
                    className={regSelect}
                    required
                  >
                    {itemType === "금" ? (
                      <>
                        <option value="" disabled>
                          선택
                        </option>
                        <optgroup label="순금">
                          <option value="24K">24K</option>
                          <option value="24K-1">24K-1</option>
                          <option value="외국금">외국금</option>
                        </optgroup>
                        <optgroup label="합금">
                          <option value="18K">18K</option>
                          <option value="14K">14K</option>
                          <option value="10K">10K</option>
                        </optgroup>
                      </>
                    ) : (
                      <>
                        <option value="크라운">크라운</option>
                        <option value="인레이">인레이</option>
                      </>
                    )}
                  </select>
                ) : usesSilverFlow ? (
                  <select
                    ref={reg("silverPurity")}
                    onKeyDown={onKeyDown("silverPurity")}
                    value={silverPurity}
                    onChange={(e) =>
                      setSilverPurity(e.target.value as SilverPurity)
                    }
                    className={regSelect}
                  >
                    {SILVER_PURITIES.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : usesPlatinumFlow ? (
                  <div className={`${regRead} text-[var(--muted)]`}>—</div>
                ) : (
                  <input
                    ref={reg("purity")}
                    onKeyDown={onKeyDown("purity")}
                    value={purity}
                    onChange={(e) => setPurity(e.target.value)}
                    className={regInput}
                    placeholder="순도"
                  />
                )}
              </div>
              {/* 매입비 (품목별 분기)
                  - 치금: a/b/c (default c, useEffect)
                  - 금 24K 계열(24K/24K-1/외국금): 매입비 없음
                  - 금 합금(18K/14K/10K): a/b/c (default b, useEffect)
                  - 금 함량 미선택(karat === ""): 합금 선택 전까지 어둡게 막아둠 */}
              <div className={`${regField} lg:gap-0`}>
                <label className={`${regLabel} lg:hidden`}>매입비</label>
                {usesGoldFlow ? (() => {
                  const isAlloy = !isChigum && !is24KFamilyNoFee(karat) && !!karat;
                  const isLockedNoFee = !isChigum && karat !== "" && is24KFamilyNoFee(karat);
                  const isLockedUnselected = !isChigum && karat === "";
                  const disabled = isLockedNoFee || isLockedUnselected;
                  const displayValue = isChigum
                    ? feeTier
                    : isLockedNoFee
                      ? "none"
                      : isLockedUnselected
                        ? ""
                        : feeTier;
                  return (
                    <select
                      ref={reg("feeTier")}
                      onKeyDown={onKeyDown("feeTier")}
                      value={displayValue}
                      onChange={(e) => setFeeTier(e.target.value as FeeTier)}
                      disabled={disabled}
                      title={
                        isLockedUnselected
                          ? "합금(18K·14K·10K) 선택 시 a/b/c"
                          : isLockedNoFee
                            ? "순금(24K·24K-1·외국금)은 매입비 없음"
                            : undefined
                      }
                      className={`${regSelect} disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:bg-[var(--surface-subtle)] disabled:text-[var(--muted)]`}
                    >
                      {isChigum ? (
                        <>
                          <option value="c">c</option>
                          <option value="b">b</option>
                          <option value="a">a</option>
                        </>
                      ) : isLockedNoFee ? (
                        <option value="none">없음</option>
                      ) : isLockedUnselected ? (
                        <option value="" disabled>
                          —
                        </option>
                      ) : isAlloy ? (
                        <>
                          <option value="b">b</option>
                          <option value="a">a</option>
                          <option value="c">c</option>
                        </>
                      ) : null}
                    </select>
                  );
                })() : usesSilverFlow || usesPlatinumFlow ? (
                  <div className={`${regRead} text-[var(--muted)]`}>—</div>
                ) : (
                  <div className="flex h-9 gap-1">
                    <input
                      ref={reg("unitPrice")}
                      onKeyDown={onKeyDown("unitPrice")}
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      className={`min-w-0 flex-1 ${regInputNum}`}
                      placeholder="단가"
                    />
                    <button
                      type="button"
                      onClick={applySuggestedTotalNonGold}
                      className="shrink-0 self-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] font-medium leading-tight text-amber-900"
                      title="중량×단가"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
              {/* 매입금액 */}
              <div className={`${regField} lg:gap-0`}>
                <label className={`${regLabel} lg:hidden`}>매입금액(원)</label>
                <input
                  ref={reg("totalAmount")}
                  onKeyDown={onKeyDown("totalAmount")}
                  value={formatWonInputDisplay(totalAmount)}
                  onChange={(e) =>
                    setTotalAmount(sanitizeWonInputDigits(e.target.value))
                  }
                  onBlur={snapPurchaseAmountInputTo1000Won}
                  className={regInputNum}
                  required
                />
              </div>
              {/* 결제 */}
              <div className={`${regField} lg:gap-0`}>
                <label className={`${regLabel} lg:hidden`}>결제</label>
                <select
                  ref={reg("paymentMethod")}
                  onKeyDown={onKeyDown("paymentMethod")}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={regSelect}
                >
                  {purchasePaymentOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              {/* 특이사항 */}
              <div className={`${regField} lg:gap-0 col-span-2 sm:col-span-4 lg:col-span-1`}>
                <label className={`${regLabel} lg:hidden`}>특이사항</label>
                <input
                  ref={reg("note")}
                  onKeyDown={onKeyDown("note")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={regInputNote}
                  placeholder="간단 메모(선택)"
                />
              </div>
            </div>
            </div>

            {/* 추가 행 — 첫 행과 동일 그리드 */}
            {extraRows.map((r) => {
              const exFlow = purchaseFlowFlags(r.itemType);
              const extraUsesGoldFlow = exFlow.usesGoldFlow;
              const extraUsesSilverFlow = exFlow.usesSilverFlow;
              const extraUsesPlatinumFlow = exFlow.usesPlatinumFlow;
              const extraUsesWeightDonDisplay = exFlow.usesWeightDonDisplay;
              const extraIsChigum = exFlow.isChigum;
              const extraKarat = r.karat;
              const extraFeeTier = r.feeTier;
              const extraWeightVal = r.weightG.trim()
                ? parseFloat(r.weightG.replace(",", "."))
                : null;
              const extraForeignGold =
                extraUsesGoldFlow &&
                !extraIsChigum &&
                isForeignGoldKarat(extraKarat);
              const extraPureG = parseForeignPureGoldGInput(r.foreignPureGoldG);
              const extraDonDisplay =
                extraUsesWeightDonDisplay &&
                extraWeightVal != null &&
                Number.isFinite(extraWeightVal)
                  ? extraForeignGold
                    ? extraPureG != null
                      ? ledgerDisplayDonFromWeightG(extraPureG)
                      : null
                    : ledgerDisplayDonFromWeightG(
                        extraUsesGoldFlow && !extraIsChigum
                          ? effectiveWeightGForGoldPurchase(
                              extraKarat,
                              extraWeightVal,
                            )
                          : extraWeightVal,
                      )
                  : null;
              return (
                <div key={r.rid} className={`relative ${purchaseRowSidePad}`}>
                  <div
                    className={`grid grid-cols-2 gap-x-2 gap-y-2.5 sm:grid-cols-4 lg:w-full ${purchaseFormGridCols} lg:items-start lg:gap-x-2 lg:gap-y-1`}
                  >
                    <div className={`${regField} lg:gap-0`}>
                      <label className={`${regLabel} lg:hidden`}>품목</label>
                      <select
                        value={r.itemType}
                        onChange={(e) => {
                          const v = e.target.value;
                          const f = purchaseFlowFlags(v);
                          const patch: Partial<ExtraPurchaseRow> = { itemType: v };
                          if (f.isChigum) {
                            patch.karat = "크라운";
                            patch.feeTier = "c";
                          } else if (f.usesGoldFlow) {
                            patch.karat =
                              r.karat === "크라운" || r.karat === "인레이"
                                ? ""
                                : r.karat;
                          } else {
                            patch.karat = "";
                          }
                          updateExtraRow(r.rid, patch);
                        }}
                        className={regSelect}
                      >
                        <option value="금">금</option>
                        <option value="은">은</option>
                        <option value="치금">치금</option>
                        <option value="백금">백금</option>
                        <option value="기타">기타</option>
                      </select>
                    </div>
                    <div className={`${regField} lg:gap-0`}>
                      <label className={`${regLabel} lg:hidden`}>고객명</label>
                      <input
                        value={extraIsChigum ? "" : sellerName}
                        onChange={(e) => setSellerName(e.target.value)}
                        disabled={extraIsChigum}
                        tabIndex={extraIsChigum ? -1 : undefined}
                        className={regInputDis}
                        placeholder={extraIsChigum ? "치금 생략" : "선택"}
                      />
                    </div>
                    <div className={`${regField} lg:gap-0`}>
                      <label className={`${regLabel} lg:hidden`}>전화번호</label>
                      <input
                        value={extraIsChigum ? "" : sellerPhone}
                        onChange={(e) =>
                          setSellerPhone(formatMobileInputDisplay(e.target.value))
                        }
                        disabled={extraIsChigum}
                        tabIndex={extraIsChigum ? -1 : undefined}
                        className={regInputDis}
                        placeholder={extraIsChigum ? "치금 생략" : "0000-0000"}
                        inputMode="tel"
                      />
                    </div>
                    <div className={`${regField} lg:gap-0`}>
                      <label className={`${regLabel} lg:hidden`}>중량(g)</label>
                      <input
                        value={r.weightG}
                        onChange={(e) =>
                          updateExtraRow(r.rid, { weightG: e.target.value })
                        }
                        className={regInputNum}
                        inputMode="decimal"
                      />
                    </div>
                    <div className={`${regField} lg:gap-0`}>
                      <label className={`${regLabel} lg:hidden`}>
                        {extraForeignGold ? "순금(g)" : "돈수"}
                      </label>
                      {extraForeignGold ? (
                        <div className="flex flex-col items-stretch gap-0.5">
                          <input
                            value={r.foreignPureGoldG}
                            onChange={(e) =>
                              updateExtraRow(r.rid, {
                                foreignPureGoldG: e.target.value,
                              })
                            }
                            className={regInputNum}
                            inputMode="decimal"
                            placeholder="순금 g"
                            title="외국금 순금 중량(g) — 함량마다 다르므로 직접 입력"
                          />
                          <span className="text-center text-[10px] tabular-nums text-[var(--muted)] lg:text-[11px]">
                            {extraDonDisplay != null
                              ? `→ ${extraDonDisplay.toFixed(2)}돈`
                              : "→ —돈"}
                          </span>
                        </div>
                      ) : (
                        <div className={regRead}>
                          {extraUsesWeightDonDisplay
                            ? extraDonDisplay != null
                              ? extraDonDisplay.toFixed(2)
                              : "—"
                            : "—"}
                        </div>
                      )}
                    </div>
                    <div className={`${regField} lg:gap-0`}>
                      <label className={`${regLabel} lg:hidden`}>함량</label>
                      {extraUsesGoldFlow ? (
                        <select
                          value={r.karat}
                          onChange={(e) => {
                            const next = e.target.value as GoldKaratSelection | "";
                            updateExtraRow(r.rid, {
                              karat: next,
                              foreignPureGoldG:
                                next === "외국금" ? r.foreignPureGoldG : "",
                            });
                          }}
                          className={regSelect}
                          required
                        >
                          {r.itemType === "금" ? (
                            <>
                              <option value="" disabled>
                                선택
                              </option>
                              <optgroup label="순금">
                                <option value="24K">24K</option>
                                <option value="24K-1">24K-1</option>
                                <option value="외국금">외국금</option>
                              </optgroup>
                              <optgroup label="합금">
                                <option value="18K">18K</option>
                                <option value="14K">14K</option>
                                <option value="10K">10K</option>
                              </optgroup>
                            </>
                          ) : (
                            <>
                              <option value="크라운">크라운</option>
                              <option value="인레이">인레이</option>
                            </>
                          )}
                        </select>
                      ) : extraUsesSilverFlow ? (
                        <select
                          value={r.silverPurity}
                          onChange={(e) =>
                            updateExtraRow(r.rid, {
                              silverPurity: e.target.value as SilverPurity,
                            })
                          }
                          className={regSelect}
                        >
                          {SILVER_PURITIES.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : extraUsesPlatinumFlow ? (
                        <div className={`${regRead} text-[var(--muted)]`}>—</div>
                      ) : (
                        <input
                          value={r.purity}
                          onChange={(e) =>
                            updateExtraRow(r.rid, { purity: e.target.value })
                          }
                          className={regInput}
                          placeholder="순도"
                        />
                      )}
                    </div>
                    <div className={`${regField} lg:gap-0`}>
                      <label className={`${regLabel} lg:hidden`}>매입비</label>
                      {extraUsesGoldFlow ? (() => {
                        const exIsLockedNoFee =
                          !extraIsChigum &&
                          extraKarat !== "" &&
                          is24KFamilyNoFee(extraKarat);
                        const exIsLockedUnselected =
                          !extraIsChigum && extraKarat === "";
                        const exIsAlloy =
                          !extraIsChigum &&
                          !exIsLockedNoFee &&
                          !exIsLockedUnselected;
                        const exDisabled =
                          exIsLockedNoFee || exIsLockedUnselected;
                        const exDisplayValue = extraIsChigum
                          ? extraFeeTier
                          : exIsLockedNoFee
                            ? "none"
                            : exIsLockedUnselected
                              ? ""
                              : extraFeeTier;
                        return (
                          <select
                            value={exDisplayValue}
                            onChange={(e) =>
                              updateExtraRow(r.rid, {
                                feeTier: e.target.value as FeeTier,
                              })
                            }
                            disabled={exDisabled}
                            title={
                              exIsLockedUnselected
                                ? "합금(18K·14K·10K) 선택 시 a/b/c"
                                : exIsLockedNoFee
                                  ? "순금(24K·24K-1·외국금)은 매입비 없음"
                                  : undefined
                            }
                            className={`${regSelect} disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:bg-[var(--surface-subtle)] disabled:text-[var(--muted)]`}
                          >
                            {extraIsChigum ? (
                              <>
                                <option value="c">c</option>
                                <option value="b">b</option>
                                <option value="a">a</option>
                              </>
                            ) : exIsLockedNoFee ? (
                              <option value="none">없음</option>
                            ) : exIsLockedUnselected ? (
                              <option value="" disabled>
                                —
                              </option>
                            ) : exIsAlloy ? (
                              <>
                                <option value="b">b</option>
                                <option value="a">a</option>
                                <option value="c">c</option>
                              </>
                            ) : null}
                          </select>
                        );
                      })() : extraUsesSilverFlow || extraUsesPlatinumFlow ? (
                        <div className={`${regRead} text-[var(--muted)]`}>—</div>
                      ) : (
                        <input
                          value={r.unitPrice}
                          onChange={(e) =>
                            updateExtraRow(r.rid, { unitPrice: e.target.value })
                          }
                          className={regInputNum}
                          placeholder="단가"
                        />
                      )}
                    </div>
                    <div className={`${regField} lg:gap-0`}>
                      <label className={`${regLabel} lg:hidden`}>매입금액(원)</label>
                      <input
                        value={formatWonInputDisplay(r.totalAmount)}
                        onChange={(e) =>
                          updateExtraRow(r.rid, {
                            totalAmount: sanitizeWonInputDigits(e.target.value),
                          })
                        }
                        className={regInputNum}
                      />
                    </div>
                    <div className={`${regField} lg:gap-0`}>
                      <label className={`${regLabel} lg:hidden`}>결제</label>
                      <select
                        value={r.paymentMethod}
                        onChange={(e) =>
                          updateExtraRow(r.rid, { paymentMethod: e.target.value })
                        }
                        className={regSelect}
                      >
                        {purchasePaymentOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div
                      className={`${regField} lg:gap-0 col-span-2 sm:col-span-4 lg:col-span-1`}
                    >
                      <label className={`${regLabel} lg:hidden`}>특이사항</label>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className={regInputNote}
                        placeholder="간단 메모(선택)"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeExtraRow(r.rid)}
                    title="줄 삭제"
                    className="absolute right-0 top-0 flex h-9 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
                  >
                    ×
                  </button>
                </div>
              );
            })}

          </div>

          <div className="flex w-full flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={reusePrevSeller}
                    onChange={(e) => setReusePrevSeller(e.target.checked)}
                    className="rounded border-[var(--border)] text-amber-700 focus:ring-amber-500"
                  />
                  직전거래
                </label>
                <button
                  type="button"
                  onClick={addExtraRow}
                  disabled={saving}
                  className="toss-btn-secondary toss-btn-sm shrink-0 disabled:opacity-50"
                >
                  + 줄추가
                </button>
                {purchaseTotalSumCard}
              </div>
              <button
                ref={reg("submitBtn")}
                onKeyDown={onKeyDown("submitBtn")}
                type="submit"
                disabled={saving || staffNeedsBranch || shopBranches.length === 0}
                className="toss-btn-primary toss-btn-md shrink-0 tracking-wide disabled:opacity-50"
              >
                {saving
                  ? "저장 중…"
                  : extraRows.length > 0
                    ? `등록 (${extraRows.length + 1}건)`
                    : "등록"}
              </button>
          </div>
        </form>
      </section>

      <DailyVaultPanel
        branchId={branchId}
        branches={branches}
        isAdmin={isAdmin}
        listLoading={loading}
        ledgerFromDate={fromDate}
        ledgerToDate={toDate}
        refreshKey={`${branchId}-${purchases.length}-${loading}`}
        className="p-4 lg:p-5"
      />
      </div>

      <section className="purchase-ledger-work-card flex min-h-[50vh] w-full flex-col overflow-hidden lg:min-h-[calc(100dvh-13rem)]">
        <div className="flex w-full min-w-0 shrink-0 flex-nowrap items-center gap-1">
          <h2 className="shrink-0 text-xs font-bold tracking-tight text-[#191f28] dark:text-[var(--foreground)]">
            매입내역
          </h2>
          <span className="shrink-0 text-[10px] font-semibold text-[#8b95a1]">날짜</span>
          <button
            type="button"
            onClick={() => setPurchaseLedgerDateSortAsc(true)}
            title="오름차순"
            className={`${purchaseLedgerToolbarPill(purchaseLedgerDateSortAsc)} shrink-0`}
          >
            오름차순
          </button>
          <button
            type="button"
            onClick={() => setPurchaseLedgerDateSortAsc(false)}
            title="내림차순"
            className={`${purchaseLedgerToolbarPill(!purchaseLedgerDateSortAsc)} shrink-0`}
          >
            내림차순
          </button>
          <button
            type="button"
            onClick={() => setPurchaseLedgerTodayOnly((v) => !v)}
            className={`${purchaseLedgerToolbarPill(purchaseLedgerTodayOnly)} shrink-0`}
          >
            오늘만
          </button>
          <div className="relative ml-2.5 shrink-0">
            <input
              type="search"
              value={purchaseLedgerSearch}
              onChange={(e) => setPurchaseLedgerSearch(e.target.value)}
              placeholder="고객명·전화·제품명 (전체 검색)"
              aria-label="고객명·전화번호·제품명(품목·함량·특이사항)으로 매입내역 전체 검색"
              title="입력하면 조회 기간을 무시하고 DB 전체에서 매칭합니다"
              className={`${purchaseLedgerToolbarField} w-[12rem] shrink-0 !px-2.5 !pr-7`}
            />
            {purchaseLedgerSearch ? (
              <button
                type="button"
                onClick={() => setPurchaseLedgerSearch("")}
                aria-label="검색어 지우기"
                title="검색어 지우기"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-xs leading-none text-[#8b95a1] hover:text-[#191f28]"
              >
                ✕
              </button>
            ) : null}
          </div>
          <span className="ml-2.5 shrink-0 text-xs font-semibold text-[#8b95a1]">기간</span>
          <input
            id="purchase-ledger-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="시작일"
            title="시작일"
            className={`${purchaseLedgerToolbarField} w-[7rem] max-w-[7rem] shrink-0 !px-1.5`}
          />
          <span className="shrink-0 text-xs text-[#8b95a1]">~</span>
          <input
            id="purchase-ledger-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="종료일"
            title="종료일"
            className={`${purchaseLedgerToolbarField} w-[7rem] max-w-[7rem] shrink-0 !px-1.5`}
          />
          <button
            type="button"
            onClick={() => void load()}
            className="purchase-ledger-btn-primary h-8 shrink-0 !px-2.5 !py-0 !text-xs leading-none"
          >
            조회
          </button>
          <p className="ml-auto min-w-0 shrink truncate text-[10px] font-medium tabular-nums text-[#8b95a1]">
            {loading
              ? "…"
              : purchaseLedgerTodayOnly || purchaseLedgerSearch.trim().length > 0
                ? `${purchasesLedgerRows.length}건 · 매입 ${formatKRW(purchaseLedgerTableSum)}${
                    purchaseLedgerTodayOnly ? " · 오늘" : ""
                  }${
                    purchaseLedgerSearch.trim().length > 0
                      ? purchaseLedgerSearchLoading
                        ? " · 검색 중"
                        : " · 전체검색"
                      : ""
                  }`
                : `${summary.count}건 · 매입 ${formatKRW(summary.sum)}`}
          </p>
        </div>
        <div
          ref={purchaseLedgerSumRef}
          className="relative min-h-0 flex-1 overflow-auto pt-2"
        >
          <LedgerSelectionSumBar
            rootRef={purchaseLedgerSumRef}
            clipboardCopy={purchaseLedgerClipboardCopy}
            headerClickSumColumns={[7]}
          />
          <table className="monthly-purchase-ledger-table ledger-cell-select w-full min-w-0 table-fixed cursor-cell select-none border-separate border-spacing-0 text-center tabular-nums">
            <colgroup>
              <col className="w-[4rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[2.75rem]" />
              <col className="w-[4.25rem]" />
              <col className="purchase-ledger-col-phone" />
              <col className="purchase-ledger-col-weight" />
              <col className="w-[3.25rem]" />
              <col className="w-[3rem]" />
              <col className="w-[2.75rem]" />
              <col className="w-[5.25rem]" />
              <col className="w-[3rem]" />
              <col className="w-[4.5rem]" />
              {isAdmin ? <col className="w-[2.75rem]" /> : null}
              <col className="w-[2.75rem]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f2f4f6] font-semibold text-[#8b95a1] shadow-[0_1px_0_0_#e8ebef] dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)] dark:shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th
                  className="whitespace-nowrap"
                  title="등록 당시 직원이 입력한 오늘의 매입시세(원/돈). 금·치금은 금시세, 은은 은시세."
                >
                  매입시세
                </th>
                <th className="whitespace-nowrap">날짜</th>
                <th>매장</th>
                <th>품목</th>
                <th>고객명</th>
                <th className="purchase-ledger-col-phone whitespace-nowrap">전화번호</th>
                <th className="purchase-ledger-col-weight whitespace-nowrap">중량(g)</th>
                <th
                  className="cursor-pointer whitespace-nowrap hover:bg-[var(--surface-subtle)]"
                  title="클릭하면 표시된 행의 돈수 합산"
                >
                  돈수
                </th>
                <th>함량</th>
                <th className="whitespace-nowrap">매입비</th>
                <th className="whitespace-nowrap">매입금액</th>
                <th>결제</th>
                <th>특이사항</th>
                {isAdmin ? <th className="whitespace-nowrap">수정</th> : null}
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={tableColSpan}
                    className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    불러오는 중…
                  </td>
                </tr>
              ) : purchases.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableColSpan}
                    className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    이 기간에 매입이 없습니다.
                  </td>
                </tr>
              ) : purchasesLedgerRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableColSpan}
                    className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    {purchaseLedgerSearch.trim().length > 0
                      ? `“${purchaseLedgerSearch.trim()}” 검색 결과가 없습니다.`
                      : `조회된 기간 안에 오늘(${todayYmdSeoul()}) 등록 매입이 없습니다.`}
                  </td>
                </tr>
              ) : (
                purchasesLedgerRows.map((p, i) => {
                  const prev = i > 0 ? purchasesLedgerRows[i - 1] : null;
                  const phoneDisp =
                    p.seller_phone?.trim() != null && p.seller_phone !== ""
                      ? normalizeKoreanMobilePhone(p.seller_phone)
                      : "";
                  const goldLike = p.item_type === "금" || p.item_type === "치금";
                  const donWeightLike = goldLike || p.item_type === "은";
                  const w = p.weight_g != null ? Number(p.weight_g) : NaN;
                  const kNorm = normalizeGoldKaratForPurchase(
                    String(p.karat ?? p.purity ?? ""),
                  );
                  const wForDon =
                    p.item_type === "금"
                      ? effectiveWeightGForGoldPurchase(
                          String(p.karat ?? p.purity ?? ""),
                          w,
                        )
                      : w;
                  const donNumForLedger =
                    kNorm === "외국금" &&
                    p.pure_gold_don != null &&
                    Number.isFinite(Number(p.pure_gold_don)) &&
                    Number(p.pure_gold_don) > 0
                      ? Number(Number(p.pure_gold_don).toFixed(2))
                      : donWeightLike && Number.isFinite(w) && w > 0
                        ? ledgerDisplayDonFromWeightG(wForDon)
                        : NaN;
                  const donFromG =
                    Number.isFinite(donNumForLedger) && donNumForLedger > 0
                      ? donNumForLedger.toFixed(2)
                      : "—";
                  const feeDisp =
                    goldLike && p.fee_tier
                      ? p.fee_tier === "none"
                        ? "없음"
                        : p.fee_tier
                      : "—";
                  const totalAmt = Number(p.total_amount);
                  const totalAmtRounded =
                    Number.isFinite(totalAmt) ? Math.round(totalAmt) : null;
                  const weightNum =
                    p.weight_g != null ? Number(p.weight_g) : NaN;
                  const weightSumAttr =
                    Number.isFinite(weightNum) ? String(weightNum) : null;
                  const ledgerDt = dailyLedgerDateCellParts(p.purchased_at);
                  const ymd = seoulYmdFromIso(p.purchased_at);
                  const prevYmd =
                    prev != null ? seoulYmdFromIso(prev.purchased_at) : null;
                  const showDate = prevYmd == null || ymd !== prevYmd;
                  // 등록 시 직원이 입력한 "오늘의 매입시세"(원/돈)를 표시. 종로 처리시세는 노출 금지.
                  // `unit_price`는 모든 저장 경로에서 입력값으로만 세팅되며 처리시세로 덮어쓰이지 않는다.
                  const entryPricePerDon = (() => {
                    if (goldLike || p.item_type === "은") {
                      const n =
                        p.unit_price != null ? Number(p.unit_price) : NaN;
                      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
                    }
                    return null;
                  })();
                  return (
                    <tr
                      key={p.id}
                      data-ledger-row={p.id}
                      className="hover:bg-gray-100/80 dark:hover:bg-gray-800/40"
                    >
                      <td
                        className="whitespace-nowrap tabular-nums text-[var(--foreground)]"
                        data-clipboard-text={
                          entryPricePerDon != null
                            ? entryPricePerDon.toLocaleString("ko-KR")
                            : ""
                        }
                      >
                        {entryPricePerDon != null
                          ? entryPricePerDon.toLocaleString("ko-KR")
                          : "—"}
                      </td>
                      <td
                        className="whitespace-nowrap tabular-nums text-[var(--foreground)]"
                        data-clipboard-text={showDate ? ymd : ""}
                      >
                        {showDate ? (
                          <span className="block leading-tight">{ledgerDt.date}</span>
                        ) : null}
                        {ledgerDt.timeHm != null ? (
                          <span
                            className={`block text-[10px] font-normal leading-none tabular-nums text-[var(--muted)]${showDate ? " mt-0.5" : ""}`}
                          >
                            {ledgerDt.timeHm}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-[var(--foreground)]">
                        {branchLabelForId(branches, p.branch_id)}
                      </td>
                      <td className="text-[var(--foreground)]">{p.item_type}</td>
                      <td className="max-w-[6rem] truncate text-[var(--foreground)]">
                        {p.seller_name != null && String(p.seller_name).trim() !== ""
                          ? p.seller_name
                          : "—"}
                      </td>
                      <td
                        className="purchase-ledger-col-phone whitespace-nowrap text-[var(--foreground)]"
                        data-clipboard-text={phoneDisp || ""}
                      >
                        {phoneDisp || "—"}
                      </td>
                      <td
                        className="purchase-ledger-col-weight tabular-nums text-[var(--foreground)]"
                        {...(weightSumAttr != null
                          ? { "data-sum-g": weightSumAttr }
                          : {})}
                      >
                        {p.weight_g != null ? p.weight_g : "—"}
                      </td>
                      <td
                        className="tabular-nums text-[var(--foreground)]"
                        {...(Number.isFinite(donNumForLedger) && donNumForLedger > 0
                          ? { "data-sum-don": String(donNumForLedger) }
                          : {})}
                      >
                        {donFromG}
                      </td>
                      <td className="text-[var(--foreground)]">
                        {p.karat ?? p.purity ?? "—"}
                      </td>
                      <td className="text-[var(--foreground)]">{feeDisp}</td>
                      <td
                        className="font-medium tabular-nums text-[var(--foreground)]"
                        {...(totalAmtRounded != null
                          ? { "data-sum-won": String(totalAmtRounded) }
                          : {})}
                      >
                        {formatKRW(Number(p.total_amount))}
                      </td>
                      <td className="text-[var(--foreground)]">
                        {p.payment_method ?? "—"}
                      </td>
                      <td className="max-w-[8rem] truncate text-[var(--muted)]">
                        {p.note != null && String(p.note).trim() !== ""
                          ? p.note
                          : "—"}
                      </td>
                      {isAdmin ? (
                        <td>
                          <button
                            type="button"
                            onClick={() => setEditingPurchase(p)}
                            className="text-xs text-amber-800 hover:underline dark:text-amber-300"
                          >
                            수정
                          </button>
                        </td>
                      ) : null}
                      <td>
                        <button
                          type="button"
                          onClick={() => void handleDelete(p.id)}
                          className="toss-link-danger text-xs hover:underline"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin ? (
        <PurchaseEditDialog
          supabase={supabase}
          purchase={editingPurchase}
          userId={profile?.id ?? ""}
          open={editingPurchase != null}
          onClose={() => setEditingPurchase(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}

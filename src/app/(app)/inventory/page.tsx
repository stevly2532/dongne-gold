"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  branchSelectRowsForShop,
  branchesForShopSelect,
  firstShopSelectableBranchId,
} from "@/lib/branchLabels";
import {
  formatKRW,
  formatWonInputDisplay,
  parseWonDigitsToNumber,
  dailyLedgerDateCellParts,
  purchaseLedgerDateCellParts,
  seoulYmdFromIso,
  sanitizeWonInputDigits,
  todayYmdSeoul,
} from "@/lib/format";
import {
  formatMobileInputDisplay,
  normalizeKoreanMobilePhone,
} from "@/lib/koreanPhone";
import {
  DAILY_PURCHASE_PRICE_SCOPE_SALES_GOLD,
  type Branch,
  type InventoryItem,
  type Profile,
} from "@/types/db";
import { DailyVaultPanel } from "@/components/DailyVaultPanel";
import { HelpTooltip } from "@/components/HelpTooltip";
import { RegistrationPageHeader } from "@/components/RegistrationPageHeader";
import { LedgerSelectionSumBar } from "@/components/LedgerSelectionSumBar";
import { InventoryEditDialog } from "@/components/InventoryEditDialog";
import { computeSuggestedInventorySellWon } from "@/lib/inventorySuggestedSellWon";
import { isPurchaseVendorName } from "@/lib/productLaborFeeMatch";
import { useAppBootstrap } from "@/components/AppProviders";
import { swrLoad } from "@/lib/queryCache";
import { buildArrivalSmsBody, openArrivalSms } from "@/lib/arrivalSms";
import { matchesLedgerCustomerSearch } from "@/lib/ledgerCustomerSearch";

/** DB kind 값 — 순서: 금, 14K, 18K, 은 */
const SALES_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "gold", label: "24K" },
  { value: "gold_14k", label: "14K" },
  { value: "gold_18k", label: "18K" },
  { value: "silver", label: "은" },
];

/** 품목이 「금」일 때 제품코드 빠른 선택(datalist) */
const GOLD_PRODUCT_NAME_OPTIONS = [
  "골드바",
  "금덩어리",
  "목걸이",
  "팔찌",
  "반지",
  "귀걸이",
  "제품",
] as const;

/** 품목이 18K·14K일 때 제품코드 빠른 선택 */
const KARAT_GOLD_PRODUCT_NAME_OPTIONS = ["목걸이", "팔찌", "반지", "귀걸이"] as const;

/** 품목이 「은」일 때 제품코드 빠른 선택 */
const SILVER_PRODUCT_NAME_OPTIONS = ["실버바 999.9"] as const;

type ProductCodePreset =
  | typeof GOLD_PRODUCT_NAME_OPTIONS[number]
  | typeof KARAT_GOLD_PRODUCT_NAME_OPTIONS[number]
  | typeof SILVER_PRODUCT_NAME_OPTIONS[number];

const LS_SALES_GOLD_PRICE_PER_DON = "goldLedger_salesGoldPricePerDon";

const PAYMENT_OPTIONS = ["현금", "통장", "카드", "현영", "기타"] as const;

const RECEIVABLE_OPTIONS = ["완불", "직접입력"] as const;
type ReceivableMode = (typeof RECEIVABLE_OPTIONS)[number];

/**
 * 매출등록 추가 행(같은 거래·여러 명세).
 * 거래 공통(고객명·전화·매장)은 첫 행 값을 그대로 따라가고,
 * 그 외 모든 필드는 행별로 다를 수 있다.
 */
type ExtraSalesRow = {
  rid: string;
  kind: string;
  productCodeMode: "preset" | "custom";
  name: string;
  productName: string;
  quantity: string;
  weightG: string;
  sellPrice: string;
  /** 사용자가 판매가를 직접 수정하면 true — 이후엔 자동계산이 덮어쓰지 않음 */
  sellPriceEdited: boolean;
  paymentMethod: string;
  receivableMode: ReceivableMode;
  receivableWonDigits: string;
  vendorName: string;
  fulfillmentStatus: string;
  size: string;
  note: string;
};

function makeExtraSalesRowId(): string {
  return `s${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankExtraSalesRow(seed: {
  kind: string;
  paymentMethod: string;
  fulfillmentStatus: string;
}): ExtraSalesRow {
  return {
    rid: makeExtraSalesRowId(),
    kind: seed.kind,
    productCodeMode: "preset",
    name: "",
    productName: "",
    quantity: "",
    weightG: "",
    sellPrice: "",
    sellPriceEdited: false,
    paymentMethod: seed.paymentMethod,
    receivableMode: "완불",
    receivableWonDigits: "",
    vendorName: "",
    fulfillmentStatus: seed.fulfillmentStatus,
    size: "",
    note: "",
  };
}

/**
 * 추가행(줄 추가) 자동 판매가 — 첫 행의 suggestedSellWon 로직을 동일하게 적용.
 * 14K(반지·귀걸이·목걸이·팔찌) 특수가격 + 일반 금속가 계산, 수량 곱하기.
 * 추가행은 공임 입력칸이 없어 공임 0으로 본다. 계산 불가면 null.
 */
function computeExtraSalesRowSuggestedWon(
  row: ExtraSalesRow,
  salesGoldPriceDigits: string,
): number | null {
  const code = String(row.name).trim();
  const goldPerDon = parseWonDigitsToNumber(salesGoldPriceDigits);
  const w = parseFloat(String(row.weightG).replace(",", "."));

  let perUnit: number | null;
  if (
    row.kind === "gold_14k" &&
    (code === "반지" || code === "귀걸이" || code === "목걸이" || code === "팔찌")
  ) {
    if (!Number.isFinite(w) || w <= 0) return null;
    if (goldPerDon == null || !Number.isFinite(goldPerDon) || goldPerDon <= 0)
      return null;
    const don = w / 3.75;
    const metalWon = goldPerDon * don * 0.6435;
    const laborCostWon = code === "목걸이" || code === "팔찌" ? 50_000 : 30_000;
    const costWon = metalWon + laborCostWon;
    const marginWon =
      code === "목걸이" || code === "팔찌"
        ? w < 1
          ? 120_000
          : 150_000
        : w < 1
          ? 100_000
          : 120_000;
    perUnit = Math.max(0, Math.round(costWon + marginWon));
  } else {
    perUnit = computeSuggestedInventorySellWon({
      kind: row.kind,
      weightG: row.weightG,
      laborFee: "",
      goldPricePerDon: goldPerDon,
      silverPricePerDon: null,
    });
  }

  if (perUnit == null || !Number.isFinite(perUnit) || perUnit <= 0) return null;
  const qParsed = parseFloat(String(row.quantity).replace(",", "."));
  const qty = Number.isFinite(qParsed) && qParsed > 0 ? qParsed : 1;
  return Math.max(0, Math.round(perUnit * qty));
}

/** 발주(출고 방식): 즉시출고 vs 주문 */
const FULFILLMENT_STATUS_OPTIONS = [
  { value: "즉시출고", label: "재고" },
  { value: "발주", label: "주문" },
] as const;

const FULFILLMENT_DEFAULT = "즉시출고";

function normalizeFulfillmentStatus(raw: string | null | undefined): string {
  const allowed = new Set<string>(
    FULFILLMENT_STATUS_OPTIONS.map((o) => o.value),
  );
  const t = raw?.trim();
  if (t && allowed.has(t)) return t;
  return FULFILLMENT_DEFAULT;
}

function fulfillmentLabel(status: string | null | undefined): string {
  const s = normalizeFulfillmentStatus(status);
  const hit = FULFILLMENT_STATUS_OPTIONS.find((o) => o.value === s);
  return hit?.label ?? s;
}

function fulfillmentFlagsFromStatus(status: string): {
  received: boolean;
  shipped: boolean;
} {
  const shipped = status === "즉시출고";
  const received = status === "즉시출고";
  return { received, shipped };
}

function fulfillmentSelectToneClass(status: string): string {
  switch (status) {
    case "즉시출고":
      return "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]";
    case "발주":
      return "border-[var(--border)] bg-[var(--surface-cream)] text-[var(--foreground)]";
    default:
      return "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]";
  }
}

function kindLabel(value: string) {
  const hit = SALES_KIND_OPTIONS.find((k) => k.value === value);
  if (hit) return hit.label;
  if (value === "other") return "기타";
  return value;
}

/** 매출내역 툴바 — 매입내역과 동일 pill·입력 톤 */
function purchaseLedgerToolbarPill(active: boolean) {
  return active
    ? "tongsang-pill tongsang-pill-active px-1.5 py-0.5 text-[10px] leading-tight"
    : "tongsang-pill tongsang-pill-inactive px-1.5 py-0.5 text-[10px] leading-tight";
}

const purchaseLedgerToolbarField =
  "purchase-ledger-field-input !mt-0 h-8 !text-xs tabular-nums";

const INVENTORY_GOLD_KINDS = new Set(["gold", "gold_14k", "gold_18k"]);

/** 등록 당시 저장된 매출시세(원/돈). 금·14K·18K=금시세, 은=종로 override, 그 외=없음. */
function inventoryEntrySalesPricePerDon(r: InventoryItem): number | null {
  if (INVENTORY_GOLD_KINDS.has(r.kind)) {
    const n =
      r.sales_gold_price_per_don != null
        ? Number(r.sales_gold_price_per_don)
        : NaN;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  if (r.kind === "silver") {
    const n =
      r.jongro_quote_override_per_don != null
        ? Number(r.jongro_quote_override_per_don)
        : NaN;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  return null;
}

function depositLedgerDisplay(r: InventoryItem): string {
  const w = r.deposit_won != null ? Number(r.deposit_won) : NaN;
  const recv = r.receivable_won != null ? Number(r.receivable_won) : NaN;
  const hasReceivable = Number.isFinite(recv) && recv > 0;
  if (Number.isFinite(w) && w > 0) return formatKRW(Math.round(w));
  if (hasReceivable && Number.isFinite(w) && w === 0) return formatKRW(0);
  if (!hasReceivable) return "완불";
  return "—";
}

function receivableLedgerDisplay(r: InventoryItem): string {
  const w = r.receivable_won != null ? Number(r.receivable_won) : NaN;
  if (Number.isFinite(w) && w > 0) return formatKRW(Math.round(w));
  return "완불";
}

/** 미수 입력 시 선금 = 판매가 − 미수. 완불이면 저장하지 않음(null). */
function depositWonFromSaleAndReceivable(
  sellOut: number | null,
  receivableOut: number | null,
): number | null {
  if (receivableOut == null || receivableOut <= 0) return null;
  if (sellOut == null || !Number.isFinite(sellOut)) return null;
  return Math.max(0, Math.round(sellOut - receivableOut));
}

function normalizeSalesKindForForm(raw: string): string {
  const allowed = new Set(SALES_KIND_OPTIONS.map((o) => o.value));
  if (allowed.has(raw)) return raw;
  if (raw === "other") return "other";
  return "gold";
}

function isMissingColumnError(err: { message?: string; code?: string } | null) {
  if (!err) return false;
  const m = (err.message ?? "").toLowerCase();
  return err.code === "PGRST204" || m.includes("column") || m.includes("schema cache");
}

function isMissingDepositWonColumn(err: { message?: string; code?: string } | null) {
  if (!err || !isMissingColumnError(err)) return false;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("deposit_won");
}

function inventoryInsertRowWithoutDepositWon<T extends { deposit_won?: number | null }>(
  row: T,
): Omit<T, "deposit_won"> {
  const { deposit_won: _omit, ...rest } = row;
  return rest;
}

function truncateWonToThousands(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n / 1000) * 1000;
}

function todayRangeLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const iso = `${y}-${m}-${day}`;
  return { from: iso, to: iso };
}

/** 매출내역 기본 조회: 한국일 기준 당월 1일 ~ 말일 (장부 일자와 동일) */
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

/** Table missing, stale PostgREST cache, or unknown relation */
function needsInventorySetupHint(err: { message?: string; code?: string } | null) {
  if (!err) return false;
  const m = (err.message ?? "").toLowerCase();
  return (
    isMissingColumnError(err) ||
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    m.includes("could not find the table") ||
    m.includes("does not exist") ||
    m.includes("schema cache")
  );
}

const INVENTORY_SETUP_HINT =
  "Supabase → SQL Editor에서 저장소의 supabase/setup_inventory_items.sql 전체를 붙여넣어 실행하세요. public.branches 가 먼저 있어야 합니다. 입고·출고 수기 컬럼 오류면 supabase/migration_inventory_received_shipped_notes.sql, 선금 컬럼 오류면 supabase/migration_inventory_deposit_won.sql 도 실행하세요. 실행 후에도 같은 메시지면 Dashboard → Project Settings → API에서 스키마를 다시 로드하세요.";

export default function InventoryPage() {
  const supabase = useMemo(() => createClient(), []);
  const bootstrap = useAppBootstrap();
  const initialLedgerRange = currentMonthRangeSeoul();
  const [profile, setProfile] = useState<Profile | null>(bootstrap.profile);
  const [branches, setBranches] = useState<Branch[]>(bootstrap.branches);
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [inventoryToEdit, setInventoryToEdit] = useState<InventoryItem | null>(
    null,
  );

  const [name, setName] = useState("");
  const [productCodeMode, setProductCodeMode] = useState<"preset" | "custom">(
    "preset",
  );
  const [productName, setProductName] = useState("");
  const [kind, setKind] = useState("gold");
  const [quantity, setQuantity] = useState("");
  const [laborFee, setLaborFee] = useState("");
  const [weightG, setWeightG] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("현금");
  const [receivableMode, setReceivableMode] = useState<ReceivableMode>("완불");
  const [receivableWonDigits, setReceivableWonDigits] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [reusePrevCustomer, setReusePrevCustomer] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [size, setSize] = useState("");
  const [note, setNote] = useState("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState(
    FULFILLMENT_DEFAULT,
  );
  const [salesGoldPricePerDon, setSalesGoldPricePerDon] = useState("");
  /** 같은 거래 안에서 다른 명세를 한꺼번에 등록하는 추가 행 — 첫 행 외 줄 추가용 */
  const [extraSalesRows, setExtraSalesRows] = useState<ExtraSalesRow[]>([]);
  const addExtraSalesRow = useCallback(() => {
    setExtraSalesRows((rs) => [
      ...rs,
      blankExtraSalesRow({
        kind,
        paymentMethod,
        fulfillmentStatus,
      }),
    ]);
  }, [kind, paymentMethod, fulfillmentStatus]);
  const removeExtraSalesRow = useCallback((rid: string) => {
    setExtraSalesRows((rs) => rs.filter((r) => r.rid !== rid));
  }, []);
  const updateExtraSalesRow = useCallback(
    (rid: string, patch: Partial<ExtraSalesRow>) => {
      setExtraSalesRows((rs) =>
        rs.map((r) => (r.rid === rid ? { ...r, ...patch } : r)),
      );
    },
    [],
  );
  /** 첫 행 + 추가 행 판매가 합계 — 줄 추가 시 고객에게 받을 총액 미리보기 */
  const salesTotalSumWon = useMemo(() => {
    const first = parseWonDigitsToNumber(sellPrice);
    let sum = first != null && Number.isFinite(first) && first > 0 ? first : 0;
    for (const r of extraSalesRows) {
      const a = parseWonDigitsToNumber(r.sellPrice);
      if (a != null && Number.isFinite(a) && a > 0) sum += a;
    }
    return sum;
  }, [sellPrice, extraSalesRows]);
  const salesLedgerSumRef = useRef<HTMLDivElement>(null);
  /** 판매가 입력란을 직접 수정·할인·고정가 등으로 확정한 뒤에는 자동 계산이 덮어쓰지 않음 */
  const sellPriceUserEditedRef = useRef(false);
  /** 매출내역 표: 날짜 정렬(기본 내림차순) · 오늘(서울일)만 — 매입내역과 동일 */
  const [salesLedgerDateSortAsc, setSalesLedgerDateSortAsc] = useState(false);
  const [salesLedgerTodayOnly, setSalesLedgerTodayOnly] = useState(false);
  const [salesLedgerUnshippedOnly, setSalesLedgerUnshippedOnly] = useState(false);
  /** 매출내역 표: 고객명·전화번호·제품명 검색어 */
  const [salesLedgerSearch, setSalesLedgerSearch] = useState("");
  const [fromDate, setFromDate] = useState(initialLedgerRange.from);
  const [toDate, setToDate] = useState(initialLedgerRange.to);

  const isAdmin = profile?.role === "admin";
  const salesHistoryClipboardCopy = useMemo(
    () => ({
      /** 매출내역: 칸별 Ctrl+C 복사 허용 (헤더 행 제외) */
      includeHeaderRow: false,
      omitLeadingDataColumns: 0,
      /** 맨 오른쪽 수정 열(관리자)은 복사 제외 */
      omitTrailingDataColumns: isAdmin ? 1 : 0,
    }),
    [isAdmin],
  );
  const staffBranchId = profile?.branch_id ?? null;
  const staffNeedsBranch = !isAdmin && !staffBranchId;
  const canUseBranchSelect = isAdmin;
  const shopBranches = useMemo(
    () => branchesForShopSelect(branches),
    [branches],
  );
  const singleShop = shopBranches.length === 1;
  const branchRows = branchSelectRowsForShop(branches);

  const productCodePresetsFor = useCallback(
    (k: string): readonly ProductCodePreset[] | null => {
      if (k === "gold") return GOLD_PRODUCT_NAME_OPTIONS;
      if (k === "gold_18k" || k === "gold_14k")
        return KARAT_GOLD_PRODUCT_NAME_OPTIONS;
      if (k === "silver") return SILVER_PRODUCT_NAME_OPTIONS;
      return null;
    },
    [],
  );
  const productCodePresets = useMemo<readonly ProductCodePreset[] | null>(
    () => productCodePresetsFor(kind),
    [productCodePresetsFor, kind],
  );

  /** 매출등록 폼 — 매입등록과 동일 toss 토큰·그리드 */
  const salesField = "flex min-w-0 flex-col gap-1";
  const salesLabel = "toss-form-label text-center";
  const salesInput =
    "toss-input h-9 w-full px-2 text-sm leading-none text-center";
  const salesInputNum = `${salesInput} tabular-nums`;
  const salesSelect = `${salesInput} text-center`;
  const salesRead =
    "toss-input flex h-9 w-full items-center justify-center bg-[var(--surface-subtle)] px-2 text-sm tabular-nums text-[var(--foreground)] text-center";
  const salesInputProductCode = `${salesInput} font-medium tabular-nums`;
  const salesInputNote =
    `${salesInput} px-1.5 text-xs leading-tight placeholder:text-[10px] placeholder:leading-tight`;
  const headerPriceChip = "toss-btn-sm disabled:opacity-50";
  const salesRowSidePad = "lg:pr-6";
  const salesFormGridCols =
    "lg:grid-cols-[minmax(2.5rem,0.55fr)_minmax(3rem,0.78fr)_minmax(3.875rem,1.05fr)_minmax(2.375rem,0.5fr)_minmax(2.625rem,0.58fr)_minmax(4.375rem,1.18fr)_minmax(2.875rem,0.6fr)_minmax(3.875rem,1.05fr)_minmax(3.125rem,0.82fr)_minmax(3.125rem,0.82fr)_minmax(2.375rem,0.5fr)_minmax(3.875rem,0.98fr)]";
  const salesFormGridWrap = `lg:w-full ${salesFormGridCols}`;
  const salesFormGridGap =
    "gap-x-2 gap-y-2.5 sm:grid-cols-4 lg:gap-x-2.5 lg:gap-y-1";
  /** 고객·전화 — 명세 그리드와 분리, 등록 폼 전체 너비 활용 */
  const salesCustomerRow =
    "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.35fr)] lg:gap-x-4";
  const salesCustomerField = "flex min-w-0 flex-col gap-1.5";
  const salesCustomerLabel =
    "text-[11px] font-semibold leading-none tracking-tight text-[var(--foreground)]";
  const salesCustomerInput =
    "toss-input h-10 w-full px-3 text-sm leading-none text-[var(--foreground)] placeholder:text-[var(--muted)]";
  const discountPanel =
    "toss-highlight-panel w-full shrink-0 px-2.5 py-2 text-[11px] text-[var(--foreground)] lg:max-w-sm";
  const discountChipActive =
    "toss-filter-active rounded-md px-2 py-1.5 text-center";
  const discountChipInactive =
    "toss-filter-inactive rounded-md px-2 py-1.5 text-center disabled:cursor-not-allowed disabled:opacity-45";

  const load = useCallback(async () => {
    setLoading(true);
    setUpdating(false);
    setError(null);
    // NOTE: profile/branches are provided by AppLayout (server) for fast tab switches.
    setProfile(bootstrap.profile);
    setBranches(bootstrap.branches);

    const staffBranchForLoad =
      bootstrap.profile.role === "staff" ? bootstrap.profile.branch_id : null;
    const cacheKey =
      staffBranchForLoad != null
        ? `inventory|branch:${staffBranchForLoad}`
        : "inventory|all";
    if (rows.length > 0) setLoading(false);

    await swrLoad<InventoryItem[]>({
      key: cacheKey,
      ttlMs: 60_000,
      fetcher: async () => {
        let query = supabase
          .from("inventory_items")
          .select("*")
          .order("sold_at", { ascending: false, nullsFirst: false })
          .order("updated_at", { ascending: false });
        if (staffBranchForLoad) {
          query = query.eq("branch_id", staffBranchForLoad);
        }
        const { data, error: qe } = await query;
        if (qe) {
          throw new Error(
            needsInventorySetupHint(qe)
              ? `${qe.message} — ${INVENTORY_SETUP_HINT}`
              : qe.message,
          );
        }
        return (data ?? []) as InventoryItem[];
      },
      onHit: (cachedRows) => {
        setRows(cachedRows);
        setLoading(false);
        setUpdating(true);
      },
      onFresh: (list) => {
        setRows(list);
        setUpdating(false);
        setLoading(false);
      },
      onError: (e) => {
        setUpdating(false);
        setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
        setLoading(false);
      },
    });
  }, [supabase, bootstrap, rows.length]);

  useEffect(() => {
    void load();
  }, [load]);

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

  useEffect(() => {
    /** 서버 응답 전 잠깐 보여주는 로컬 캐시값. 진실의 원천은 서버. */
    if (typeof window === "undefined") return;
    const v = localStorage.getItem(LS_SALES_GOLD_PRICE_PER_DON);
    if (v) setSalesGoldPricePerDon(sanitizeWonInputDigits(v));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (salesGoldPricePerDon.trim()) {
      localStorage.setItem(LS_SALES_GOLD_PRICE_PER_DON, salesGoldPricePerDon.trim());
    }
  }, [salesGoldPricePerDon]);

  const [serverSalesGoldPriceDigits, setServerSalesGoldPriceDigits] = useState<
    string | null
  >(null);
  const [salesPriceLoading, setSalesPriceLoading] = useState(false);
  const [salesPriceSaving, setSalesPriceSaving] = useState(false);
  const [salesPriceSaveHint, setSalesPriceSaveHint] = useState(false);
  const [salesPriceEditing, setSalesPriceEditing] = useState(false);
  const salesPriceBeforeEditRef = useRef("");

  const loadSalesGoldPrice = useCallback(async () => {
    setSalesPriceLoading(true);
    const ymd = todayYmdSeoul();
    const { data, error } = await supabase
      .from("daily_purchase_prices")
      .select("price_per_don")
      .eq("quote_date", ymd)
      .eq("quote_scope", DAILY_PURCHASE_PRICE_SCOPE_SALES_GOLD)
      .maybeSingle();
    setSalesPriceLoading(false);
    if (error) {
      const m = (error.message ?? "").toLowerCase();
      if (
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        m.includes("does not exist") ||
        m.includes("schema cache")
      ) {
        setError(
          "오늘의 매출 시세를 서버와 공유하려면 Supabase에서 supabase/migration_daily_purchase_prices.sql 을 실행하세요.",
        );
      } else {
        console.error("loadSalesGoldPrice", error);
      }
      return;
    }
    if (data?.price_per_don != null) {
      const n = Number(data.price_per_don);
      if (Number.isFinite(n) && n >= 0) {
        const digits = sanitizeWonInputDigits(String(Math.round(n)));
        setServerSalesGoldPriceDigits(digits);
        setSalesGoldPricePerDon(digits);
        return;
      }
    }
    setServerSalesGoldPriceDigits(null);
  }, [supabase]);

  useEffect(() => {
    void loadSalesGoldPrice();
  }, [loadSalesGoldPrice]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void loadSalesGoldPrice();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadSalesGoldPrice]);

  const saveSalesGoldPriceToServer = useCallback(async () => {
    if (!isAdmin) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("로그인이 필요합니다.");
      return;
    }
    const n = parseWonDigitsToNumber(salesGoldPricePerDon);
    if (n == null || !Number.isFinite(n) || n < 0) {
      setError("매출 시세는 0 이상의 숫자로 입력하세요.");
      return;
    }
    setSalesPriceSaving(true);
    setError(null);
    const ymd = todayYmdSeoul();
    const { error: upErr } = await supabase
      .from("daily_purchase_prices")
      .upsert(
        {
          quote_date: ymd,
          quote_scope: DAILY_PURCHASE_PRICE_SCOPE_SALES_GOLD,
          price_per_don: Math.floor(n),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "quote_date,quote_scope" },
      );
    setSalesPriceSaving(false);
    if (upErr) {
      const m = (upErr.message ?? "").toLowerCase();
      if (
        upErr.code === "42P01" ||
        upErr.code === "PGRST205" ||
        m.includes("does not exist") ||
        m.includes("schema cache")
      ) {
        setError(
          "오늘의 매출 시세를 저장하려면 Supabase에서 supabase/migration_daily_purchase_prices.sql 을 실행하세요.",
        );
      } else {
        setError(upErr.message || "매출 시세를 저장하지 못했습니다.");
      }
      return;
    }
    const saved = sanitizeWonInputDigits(String(Math.floor(n)));
    setServerSalesGoldPriceDigits(saved);
    setSalesPriceSaveHint(true);
    setSalesPriceEditing(false);
    if (typeof window !== "undefined") {
      window.setTimeout(() => setSalesPriceSaveHint(false), 2000);
    }
  }, [isAdmin, salesGoldPricePerDon, supabase]);

  const startEditSalesPrice = useCallback(() => {
    salesPriceBeforeEditRef.current = salesGoldPricePerDon;
    setSalesPriceEditing(true);
  }, [salesGoldPricePerDon]);

  const cancelEditSalesPrice = useCallback(() => {
    setSalesGoldPricePerDon(
      salesPriceBeforeEditRef.current || serverSalesGoldPriceDigits || "",
    );
    setSalesPriceEditing(false);
  }, [serverSalesGoldPriceDigits]);

  const suggestedSellWon = useMemo(
    () =>
      (() => {
        // Special pricing: 14K + (ring/necklace/bracelet) product code
        // base_metal = ( (weight_g / 3.75) * 0.6435 * quote_gold_per_don )
        // cost = base_metal + labor_cost (공임원가)
        // sell = cost + margin (target margin)
        // - ring(반지): w < 1g ? 100,000 : 120,000
        // - necklace/bracelet(목걸이/팔찌): w < 1g ? 120,000 : 150,000
        const code = String(name).trim();
        if (
          kind === "gold_14k" &&
          (code === "반지" || code === "귀걸이" || code === "목걸이" || code === "팔찌")
        ) {
          const w = parseFloat(String(weightG).replace(",", "."));
          const q = parseWonDigitsToNumber(salesGoldPricePerDon);
          if (!Number.isFinite(w) || w <= 0) return null;
          if (q == null || !Number.isFinite(q) || q <= 0) return null;
          const don = w / 3.75;
          const metalWon = q * don * 0.6435;
          const laborCostWon = code === "목걸이" || code === "팔찌" ? 50_000 : 30_000;
          const costWon = metalWon + laborCostWon;
          const marginWon =
            code === "목걸이" || code === "팔찌"
              ? w < 1
                ? 120_000
                : 150_000
              : w < 1
                ? 100_000
                : 120_000;
          const out = Math.max(0, Math.round(costWon + marginWon));
          return out;
        }

        return computeSuggestedInventorySellWon({
          kind,
          weightG,
          laborFee,
          goldPricePerDon: parseWonDigitsToNumber(salesGoldPricePerDon),
          silverPricePerDon: null,
        });
      })(),
    [kind, name, weightG, laborFee, salesGoldPricePerDon],
  );

  const quantityNum = useMemo(() => {
    const q = parseFloat(String(quantity).replace(",", "."));
    if (!Number.isFinite(q) || q <= 0) return null;
    return q;
  }, [quantity]);

  const suggestedSellWonTotal = useMemo(() => {
    if (suggestedSellWon == null) return null;
    if (!Number.isFinite(suggestedSellWon) || suggestedSellWon <= 0) return null;
    const q = quantityNum ?? 1;
    return Math.max(0, Math.round(suggestedSellWon * q));
  }, [suggestedSellWon, quantityNum]);

  const isGoldBarSelected = useMemo(() => {
    return productCodeMode !== "custom" && String(name).trim() === "골드바";
  }, [productCodeMode, name]);

  const isEarringProductSelected = useMemo(() => {
    return String(name).trim() === "귀걸이";
  }, [name]);

  const is14KEarringSelected = useMemo(() => {
    return kind === "gold_14k" && String(name).trim() === "귀걸이";
  }, [kind, name]);

  const hasWeightInput = useMemo(() => {
    const w = weightG.trim() ? parseFloat(weightG.replace(",", ".")) : NaN;
    return Number.isFinite(w) && w > 0;
  }, [weightG]);

  const showPiercingSellPriceBanner = useMemo(() => {
    // 귀걸이 + 금(순금)일 때는 피어싱 판매가 배너를 숨김
    // 14K 귀걸이는 아래 할인 블록에서 피어싱을 선택함
    return isEarringProductSelected && kind !== "gold" && !is14KEarringSelected;
  }, [isEarringProductSelected, kind, is14KEarringSelected]);

  const isNecklaceOrBraceletSelected = useMemo(() => {
    const n = String(name).trim();
    return n === "목걸이" || n === "팔찌";
  }, [name]);

  const showSellDiscountBlock = useMemo(() => {
    if (isNecklaceOrBraceletSelected) return true;
    return kind === "gold_14k" && String(name).trim() === "반지";
  }, [isNecklaceOrBraceletSelected, kind, name]);

  const canApplySuggestedSellDiscount = useMemo(() => {
    return (
      suggestedSellWonTotal != null &&
      Number.isFinite(suggestedSellWonTotal) &&
      suggestedSellWonTotal > 0
    );
  }, [suggestedSellWonTotal]);

  /** 품목 「금」+ 제품코드 「반지」— 돌반지 시세 반영 */
  const isGoldRingSelected = useMemo(() => {
    return kind === "gold" && String(name).trim() === "반지";
  }, [kind, name]);

  const [dolRingLaborZero, setDolRingLaborZero] = useState(false);
  useEffect(() => {
    if (!isGoldRingSelected) {
      setDolRingLaborZero(false);
    }
  }, [isGoldRingSelected]);

  const goldRingBaselineSellWon = useMemo(() => {
    if (
      suggestedSellWonTotal != null &&
      Number.isFinite(suggestedSellWonTotal) &&
      suggestedSellWonTotal > 0
    )
      return Math.round(suggestedSellWonTotal);
    const q = parseWonDigitsToNumber(salesGoldPricePerDon);
    if (q != null && Number.isFinite(q) && q > 0) {
      const qty = quantityNum ?? 1;
      return Math.round(q * qty);
    }
    return null;
  }, [suggestedSellWonTotal, salesGoldPricePerDon, quantityNum]);

  const [sellDiscountSelectedWon, setSellDiscountSelectedWon] = useState<
    number | null
  >(null);
  const [goldRingDiscountSelectedWon, setGoldRingDiscountSelectedWon] = useState<
    number | null
  >(null);

  const applyGoldRingSellPriceFromTodayQuote = useCallback(() => {
    if (goldRingBaselineSellWon == null) return;
    sellPriceUserEditedRef.current = true;
    setSellPrice(
      sanitizeWonInputDigits(String(truncateWonToThousands(goldRingBaselineSellWon))),
    );
  }, [goldRingBaselineSellWon]);

  const applyGoldRingDiscount = useCallback(
    (discountWon: number) => {
      if (goldRingBaselineSellWon == null) return;
      const d = Math.max(0, Math.round(discountWon));
      const next = Math.max(0, goldRingBaselineSellWon - d);
      sellPriceUserEditedRef.current = true;
      setSellPrice(sanitizeWonInputDigits(String(truncateWonToThousands(next))));
      setGoldRingDiscountSelectedWon(d);
    },
    [goldRingBaselineSellWon],
  );

  const [goldBarSelectedLaborWon, setGoldBarSelectedLaborWon] = useState<
    number | null
  >(null);

  const applyGoldBarLaborFee = useCallback(
    (won: number) => {
      const rounded = Math.max(0, Math.round(won));
      if (goldBarSelectedLaborWon === rounded) {
        setLaborFee("");
        setGoldBarSelectedLaborWon(null);
        return;
      }
      setLaborFee(String(rounded));
      setGoldBarSelectedLaborWon(rounded);
    },
    [goldBarSelectedLaborWon],
  );

  /** 제품코드 변경 시 골드바·할인 선택 초기화 */
  const prevProductCodeRef = useRef<string>("");
  useEffect(() => {
    const curr = String(name);
    const prev = prevProductCodeRef.current;
    prevProductCodeRef.current = curr;
    if (prev !== "" && curr !== prev) {
      setGoldBarSelectedLaborWon(null);
      setSellDiscountSelectedWon(null);
      setGoldRingDiscountSelectedWon(null);
      sellPriceUserEditedRef.current = false;
    }
  }, [name]);

  /** 업체명 매입이면 공임 없음 */
  useEffect(() => {
    if (goldBarSelectedLaborWon != null) return;
    if (isPurchaseVendorName(vendorName)) {
      setLaborFee("");
    }
  }, [vendorName, goldBarSelectedLaborWon]);

  /** 할인 총액 상한(계산된 판매가 대비) */
  const MAX_SELL_DISCOUNT_FROM_BASELINE_WON = 30_000;

  /**
   * 추천(계산) 판매가를 기준으로만 할인 적용. 같은 버튼·다른 버튼을 다시 눌러도
   * 기준가에서 할인액만큼만 반영되며, 총 할인은 3만원을 넘지 않음.
   */
  const applySellDiscount = useCallback(
    (discountWon: number) => {
      if (
        suggestedSellWonTotal == null ||
        !Number.isFinite(suggestedSellWonTotal) ||
        suggestedSellWonTotal <= 0
      ) {
        return;
      }
      const baseline = Math.round(suggestedSellWonTotal);
      const d = Math.min(
        Math.max(0, discountWon),
        MAX_SELL_DISCOUNT_FROM_BASELINE_WON,
      );
      const next = Math.max(0, baseline - d);
      sellPriceUserEditedRef.current = true;
      setSellPrice(sanitizeWonInputDigits(String(truncateWonToThousands(next))));
      setSellDiscountSelectedWon(d);
    },
    [suggestedSellWonTotal],
  );

  /** 자동 계산 판매가: 사용자가 판매가를 직접 바꾸기 전까지만 입력란에 반영 */
  useEffect(() => {
    if (sellPriceUserEditedRef.current) return;
    if (suggestedSellWonTotal == null) return;
    setSellPrice(String(truncateWonToThousands(suggestedSellWonTotal)));
  }, [suggestedSellWonTotal]);

  /** 중량 미입력 시 자동 계산만 0으로 — 직접 입력한 판매가는 유지 */
  useEffect(() => {
    if (sellPriceUserEditedRef.current) return;
    const w = weightG.trim() ? parseFloat(weightG.replace(",", ".")) : NaN;
    if (!Number.isFinite(w) || w <= 0) {
      setSellPrice(sanitizeWonInputDigits("0"));
    }
  }, [weightG]);

  /**
   * 추가행(줄 추가) 판매가 자동 계산 — 첫 행과 동일하게 시세·중량 기반으로 채운다.
   * 사용자가 그 행의 판매가를 직접 수정(sellPriceEdited)하면 더 이상 덮어쓰지 않는다.
   */
  useEffect(() => {
    setExtraSalesRows((rows) => {
      let changed = false;
      const next = rows.map((r) => {
        if (r.sellPriceEdited) return r;
        const sug = computeExtraSalesRowSuggestedWon(r, salesGoldPricePerDon);
        const nextDigits =
          sug != null
            ? sanitizeWonInputDigits(String(truncateWonToThousands(sug)))
            : "";
        if (nextDigits === r.sellPrice) return r;
        changed = true;
        return { ...r, sellPrice: nextDigits };
      });
      return changed ? next : rows;
    });
  }, [extraSalesRows, salesGoldPricePerDon]);

  const effectiveBranchId =
    profile?.role === "staff" && profile.branch_id
      ? profile.branch_id
      : branchId;

  const rowsInPeriod = useMemo(() => {
    // 매출내역 "미출고"는 날짜(from/to)와 무관하게 전체 미출고를 보여준다.
    if (salesLedgerUnshippedOnly) return rows;
    return rows.filter((r) => {
      const ymd = seoulYmdFromIso(r.sold_at ?? r.updated_at);
      return ymd >= fromDate && ymd <= toDate;
    });
  }, [rows, fromDate, toDate, salesLedgerUnshippedOnly]);

  const recentCustomerFromLedger = useMemo(() => {
    if (!effectiveBranchId) return null;
    const sorted = [...rowsInPeriod]
      .filter((r) => r.branch_id === effectiveBranchId)
      .sort(
        (a, b) =>
          new Date(b.sold_at ?? b.updated_at).getTime() -
          new Date(a.sold_at ?? a.updated_at).getTime(),
      );
    for (const r of sorted) {
      const name = r.customer_name?.trim() || "";
      const phone = r.customer_phone?.trim() || "";
      if (name || phone) {
        return { name, phone };
      }
    }
    return null;
  }, [rowsInPeriod, effectiveBranchId]);
  const hasPrevCustomer = recentCustomerFromLedger != null;

  const salesSummary = useMemo(() => {
    const sum = rowsInPeriod.reduce((a, r) => {
      const n = r.sell_price != null ? Number(r.sell_price) : NaN;
      return a + (Number.isFinite(n) ? Math.round(n) : 0);
    }, 0);
    return { count: rowsInPeriod.length, sum };
  }, [rowsInPeriod]);

  const salesLedgerRows = useMemo(() => {
    const ymdToday = todayYmdSeoul();
    const q = salesLedgerSearch.trim();
    /**
     * 검색어가 있으면 조회 기간(rowsInPeriod) 대신 전체 DB(rows)에서 매칭.
     * 사용자 의도: "기간을 안 늘려도 과거 자료까지 찾고 싶다".
     */
    let list = q.length > 0 ? [...rows] : [...rowsInPeriod];
    if (salesLedgerTodayOnly) {
      list = list.filter((r) => {
        const sold = r.sold_at ?? r.updated_at;
        return seoulYmdFromIso(sold) === ymdToday;
      });
    }
    if (salesLedgerUnshippedOnly) {
      list = list.filter((r) => ledgerShippedDisplay(r).trim() === "");
    }
    if (q.length > 0) {
      list = list.filter((r) =>
        matchesLedgerCustomerSearch(
          q,
          r.customer_name,
          r.customer_phone,
          r.product_name,
        ),
      );
    }
    list.sort((a, b) => {
      const ta = new Date(a.sold_at ?? a.updated_at).getTime();
      const tb = new Date(b.sold_at ?? b.updated_at).getTime();
      return salesLedgerDateSortAsc ? ta - tb : tb - ta;
    });
    return list;
  }, [
    rows,
    rowsInPeriod,
    salesLedgerTodayOnly,
    salesLedgerUnshippedOnly,
    salesLedgerDateSortAsc,
    salesLedgerSearch,
  ]);

  const salesLedgerTableSum = useMemo(
    () =>
      salesLedgerRows.reduce((a, r) => {
        const n = r.sell_price != null ? Number(r.sell_price) : NaN;
        return a + (Number.isFinite(n) ? Math.round(n) : 0);
      }, 0),
    [salesLedgerRows],
  );

  function resetForm() {
    sellPriceUserEditedRef.current = false;
    setName("");
    setProductCodeMode("preset");
    setProductName("");
    setKind("gold");
    setQuantity("");
    setLaborFee("");
    setWeightG("");
    setSellPrice("");
    setPaymentMethod("현금");
    setReceivableMode("완불");
    setReceivableWonDigits("");
    setCustomerName("");
    setCustomerPhone("");
    setVendorName("");
    setSize("");
    setNote("");
    setFulfillmentStatus(FULFILLMENT_DEFAULT);
    setExtraSalesRows([]);
  }

  /**
   * 행 단위 payload 빌더. 첫 행은 form state를 넘기고, 추가 행은 ExtraSalesRow + 거래 공통 정보를 넘긴다.
   * 거래 공통(고객명·전화·매장·매출시세·sold_at)은 항상 첫 행과 동일.
   */
  function buildSalesRowPayload(input: {
    kind: string;
    name: string;
    productName: string;
    quantity: string;
    weightG: string;
    sellPrice: string;
    paymentMethod: string;
    receivableMode: ReceivableMode;
    receivableWonDigits: string;
    vendorName: string;
    fulfillmentStatus: string;
    size: string;
    note: string;
    /** 거래 공통 — 첫 행에서 결정 */
    branchForSave: string | null;
    soldIso: string;
    customerName: string;
    customerPhone: string;
    salesGoldPricePerDon: string;
    /** "공임" (첫 행 전용 자동 입력) — 추가 행은 항상 null */
    laborFee?: string;
  }) {
    if (!input.name.trim()) return { error: "제품코드를 입력하세요." as const };
    const qty = parseFloat(input.quantity.replace(",", "."));
    if (!Number.isFinite(qty))
      return { error: "수량은 숫자로 입력하세요." as const };

    let purityOut: string | null = null;
    if (input.kind === "gold_18k") purityOut = "18K";
    else if (input.kind === "gold_14k") purityOut = "14K";

    const w = input.weightG.trim()
      ? parseFloat(input.weightG.replace(",", "."))
      : null;
    /** 매출등록 참고표는 판매가 계산용 — DB 공임은 매출장부에서 공임관리 값으로 채움 */
    const labor = null;
    const sell = input.sellPrice.trim()
      ? parseFloat(input.sellPrice.replace(/,/g, ""))
      : null;
    if (labor != null && !Number.isFinite(labor))
      return { error: "공임은 숫자로 입력하세요." as const };
    if (w != null && !Number.isFinite(w))
      return { error: "중량은 숫자로 입력하세요." as const };
    if (sell != null && !Number.isFinite(sell))
      return { error: "판매가는 숫자로 입력하세요." as const };

    const fs = normalizeFulfillmentStatus(input.fulfillmentStatus);
    const { received, shipped } = fulfillmentFlagsFromStatus(fs);
    const orderRefOut = fs === "즉시출고" ? "완료" : null;

    const receivable =
      input.receivableMode === "직접입력"
        ? parseFloat(input.receivableWonDigits.replace(/,/g, ""))
        : 0;
    const receivableOut =
      input.receivableMode === "직접입력" &&
      Number.isFinite(receivable) &&
      receivable > 0
        ? Math.round(receivable)
        : null;

    const sellOut =
      sell != null && Number.isFinite(sell)
        ? truncateWonToThousands(sell)
        : null;

    const depositOut = depositWonFromSaleAndReceivable(sellOut, receivableOut);

    const salesQuotePerDon = (() => {
      if (!INVENTORY_GOLD_KINDS.has(input.kind)) return null;
      const q = parseWonDigitsToNumber(input.salesGoldPricePerDon);
      if (q == null || !Number.isFinite(q) || q < 0) return null;
      return Math.floor(q);
    })();

    return {
      error: null as null,
      payload: {
        branch_id: input.branchForSave,
        sold_at: input.soldIso,
        name: input.name.trim(),
        kind: input.kind,
        quantity: qty,
        unit: "g",
        labor_fee: labor,
        weight_g: w,
        purity: purityOut,
        sell_price: sellOut,
        payment_method: input.paymentMethod,
        receivable_won: receivableOut,
        deposit_won: depositOut,
        received,
        shipped,
        fulfillment_status: fs,
        product_name: input.productName.trim() || null,
        customer_name: input.customerName.trim() || null,
        customer_phone:
          normalizeKoreanMobilePhone(input.customerPhone) || null,
        vendor_name: input.vendorName.trim() || null,
        order_ref: orderRefOut,
        size: input.size.trim() || null,
        note: input.note.trim() || null,
        cost_price: null as number | null,
        sales_gold_price_per_don: salesQuotePerDon,
      },
    };
  }

  /** 기존 호출자 호환용: 첫 행 form state로 payload 생성. */
  function buildPayload() {
    const branchForSave =
      profile?.role === "staff" && profile.branch_id
        ? profile.branch_id
        : effectiveBranchId || null;
    return buildSalesRowPayload({
      kind,
      name,
      productName,
      quantity,
      weightG,
      sellPrice,
      paymentMethod,
      receivableMode,
      receivableWonDigits,
      vendorName,
      fulfillmentStatus,
      size,
      note,
      branchForSave,
      soldIso: new Date().toISOString(),
      customerName,
      customerPhone,
      salesGoldPricePerDon,
      laborFee,
    });
  }

  const handleSalesFormKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLFormElement>) => {
      if (e.key !== "Enter") return;
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName === "TEXTAREA") return;

      const isField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement;
      if (!isField) return;

      if (target instanceof HTMLInputElement) {
        if (target.type === "hidden" || target.disabled || target.readOnly) return;
      }
      if (target instanceof HTMLSelectElement && target.disabled) return;
      if (target instanceof HTMLTextAreaElement && target.disabled) return;

      e.preventDefault();

      const form = e.currentTarget;
      const controls = Array.from(form.elements).filter((el): el is HTMLElement => {
        if (!(el instanceof HTMLElement)) return false;
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLSelectElement ||
          el instanceof HTMLTextAreaElement
        ) {
          if (el.hidden) return false;
          if (el instanceof HTMLInputElement && el.type === "hidden") return false;
          if (el.disabled) return false;
          if (el instanceof HTMLInputElement && el.readOnly) return false;
          return true;
        }
        return false;
      });

      const idx = controls.indexOf(target);
      if (idx === -1) return;
      const next = controls[idx + 1];
      if (next) {
        next.focus();
      } else {
        target.blur();
      }
    },
    [],
  );

  async function handleAdd() {
    if (!effectiveBranchId) {
      setError("매장을 선택하세요.");
      return;
    }
    const firstBuilt = buildPayload();
    if (firstBuilt.error) {
      setError(firstBuilt.error);
      return;
    }
    /** 같은 거래는 같은 sold_at + 같은 거래 공통값을 공유한다. */
    const soldIso = firstBuilt.payload.sold_at;
    const branchForSave = firstBuilt.payload.branch_id;
    const customerNameShared = customerName;
    const customerPhoneShared = customerPhone;
    const quotePerDonShared = salesGoldPricePerDon;

    const extraPayloads: typeof firstBuilt.payload[] = [];
    for (let i = 0; i < extraSalesRows.length; i++) {
      const r = extraSalesRows[i];
      const built = buildSalesRowPayload({
        kind: r.kind,
        name: r.name,
        productName: r.productName,
        quantity: r.quantity,
        weightG: r.weightG,
        sellPrice: r.sellPrice,
        paymentMethod: r.paymentMethod,
        receivableMode: r.receivableMode,
        receivableWonDigits: r.receivableWonDigits,
        vendorName: r.vendorName,
        fulfillmentStatus: r.fulfillmentStatus,
        size: r.size,
        note: r.note,
        branchForSave,
        soldIso,
        customerName: customerNameShared,
        customerPhone: customerPhoneShared,
        salesGoldPricePerDon: quotePerDonShared,
      });
      if (built.error) {
        setError(`${i + 2}번째 명세: ${built.error}`);
        return;
      }
      extraPayloads.push(built.payload);
    }

    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("로그인이 필요합니다.");
      setSaving(false);
      return;
    }

    const inserts = [
      { owner_id: user.id, ...firstBuilt.payload },
      ...extraPayloads.map((p) => ({ owner_id: user.id, ...p })),
    ];

    let { error: ie } = await supabase.from("inventory_items").insert(inserts);

    if (ie && isMissingDepositWonColumn(ie)) {
      const fallbackInserts = inserts.map((row) =>
        inventoryInsertRowWithoutDepositWon(row),
      );
      ({ error: ie } = await supabase
        .from("inventory_items")
        .insert(fallbackInserts));
    }

    if (ie) {
      setError(
        needsInventorySetupHint(ie)
          ? `${ie.message} — ${INVENTORY_SETUP_HINT}`
          : ie.message,
      );
      setSaving(false);
      return;
    }
    resetForm();
    await load();
    setSaving(false);
  }

  function ledgerReceivedDisplay(r: InventoryItem): string {
    const n = r.received_note?.trim();
    if (n) return n === "완료" ? "완" : n.slice(0, 1);
    return r.received ? "완" : "";
  }

  function ledgerShippedDisplay(r: InventoryItem): string {
    const n = r.shipped_note?.trim();
    if (n) return n === "완료" ? "완" : n.slice(0, 1);
    return r.shipped ? "완" : "";
  }

  function ledgerOrderRefDisplay(r: InventoryItem): string {
    const t = r.order_ref?.trim();
    return t ? t.slice(0, 1) : "";
  }

  /** 매출내역 미니칸 저장 후 전체 `load()` 대신 행만 갱신 — 스크롤 위치 유지 */
  function patchInventoryRowFromLedgerSave(
    id: string,
    patch: Partial<InventoryItem>,
  ) {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    setInventoryToEdit((cur) =>
      cur?.id === id ? { ...cur, ...patch } : cur,
    );
  }

  async function saveLedgerInOutNote(
    row: InventoryItem,
    field: "received" | "shipped",
    raw: string,
  ) {
    const trimmed = raw.trim();
    const prev =
      field === "received"
        ? ledgerReceivedDisplay(row).trim()
        : ledgerShippedDisplay(row).trim();
    if (trimmed === prev) return;

    let clearReceivableOnShipped = false;
    if (field === "shipped" && trimmed.length > 0) {
      const receivable = row.receivable_won != null ? Number(row.receivable_won) : NaN;
      if (Number.isFinite(receivable) && receivable > 0) {
        if (
          !confirm(
            `미수금 ${formatKRW(Math.round(receivable))}이 남아 있습니다.\n` +
              `미수금액을 완불로 처리하고 출고를 '완'으로 저장합니다.\n\n계속할까요?`,
          )
        ) {
          return;
        }
        clearReceivableOnShipped = true;
      }
    }

    setError(null);
    const base = { updated_at: new Date().toISOString() };
    const payload =
      field === "received"
        ? {
            ...base,
            received_note: trimmed || null,
            received: trimmed.length > 0,
            ...(trimmed.length === 0
              ? { shipped_note: null as string | null, shipped: false }
              : {}),
          }
        : {
            ...base,
            shipped_note: (trimmed === "완" ? "완료" : trimmed) || null,
            shipped: trimmed.length > 0,
            ...(clearReceivableOnShipped
              ? { receivable_won: null as number | null }
              : {}),
            // 출고 완료 시 입고가 비어 있으면 함께 완료 처리
            ...(trimmed.length > 0 && ledgerReceivedDisplay(row) !== "완"
              ? {
                  received_note: "완료" as string | null,
                  received: true,
                }
              : {}),
          };

    const { error: ue } = await supabase
      .from("inventory_items")
      .update(payload)
      .eq("id", row.id);
    if (ue) {
      setError(
        needsInventorySetupHint(ue)
          ? `${ue.message} — ${INVENTORY_SETUP_HINT}`
          : ue.message,
      );
      return;
    }
    patchInventoryRowFromLedgerSave(row.id, payload as Partial<InventoryItem>);
    // 입고완료 시 문자는 자동 발송하지 않는다. '문자' 버튼으로 직접 보내야
    // 발송 여부(버튼 색)를 구분할 수 있다.
  }

  async function saveLedgerOrderRef(row: InventoryItem, raw: string) {
    const trimmed = raw.trim();
    const prev = ledgerOrderRefDisplay(row).trim();
    if (trimmed === prev) return;

    setError(null);
    const updatedAt = new Date().toISOString();
    const order_ref =
      trimmed.length > 0
        ? trimmed === "완"
          ? "완"
          : trimmed.slice(0, 20)
        : null;

    const { error: ue } = await supabase
      .from("inventory_items")
      .update({ order_ref, updated_at: updatedAt })
      .eq("id", row.id);
    if (ue) {
      setError(
        needsInventorySetupHint(ue)
          ? `${ue.message} — ${INVENTORY_SETUP_HINT}`
          : ue.message,
      );
      return;
    }
    patchInventoryRowFromLedgerSave(row.id, {
      order_ref,
      updated_at: updatedAt,
    });
  }

  /** 입고 안내 문자 발송 성공 시 호출 — 발송 시각을 저장하고 표에 색으로 표시. */
  async function markArrivalSmsSent(rowId: string) {
    const sentAt = new Date().toISOString();
    patchInventoryRowFromLedgerSave(rowId, { arrival_sms_sent_at: sentAt });
    await supabase
      .from("inventory_items")
      .update({ arrival_sms_sent_at: sentAt })
      .eq("id", rowId);
    // 컬럼 미존재 등 저장 실패해도 발송 자체는 성공이므로 흐름을 막지 않는다.
  }

  /** 매출등록 필드 순 + 주문/입출고 + 수정(관리자) */
  const tableColSpan = isAdmin ? 18 : 17;

  const salesFormHintTooltip = (
    <div className="space-y-1.5 text-left">
      <ul className="list-inside list-disc space-y-1">
        <li>
          등록 후 고객란은 초기화 · <strong>직전거래</strong>는 이 매장 최근 매출
          고객
        </li>
        <li>금·14K·18K 판매가는 오늘의 매출시세 기준 자동 계산</li>
      </ul>
    </div>
  );

  return (
    <div className="space-y-4">
      {staffNeedsBranch ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          소속 매장이 없습니다. 관리자에게 지점을 배정해 달라고 하세요.
        </div>
      ) : null}

      {error ? (
        <div className="toss-alert-error rounded-xl px-4 py-3 text-sm">
          {error}
          <p className="mt-2 text-xs text-[var(--muted)]">
            <strong className="font-medium">한 번에 해결:</strong>{" "}
            <code className="rounded bg-red-100 px-1">supabase/setup_inventory_items.sql</code>{" "}
            전체를 SQL Editor에서 실행하세요. 진행상태 오류면{" "}
            <code className="rounded bg-red-100 px-1">
              supabase/migration_inventory_fulfillment_status.sql
            </code>
            · 입고/출고 수기 컬럼 오류면{" "}
            <code className="rounded bg-red-100 px-1">
              supabase/migration_inventory_received_shipped_notes.sql
            </code>
            · 받은금액(선금) 컬럼 오류면{" "}
            <code className="rounded bg-red-100 px-1">
              supabase/migration_inventory_deposit_won.sql
            </code>
            도 실행하세요. 그다음 API 설정에서 스키마를 다시 로드하세요.
          </p>
        </div>
      ) : null}

      <div className="sales-registration-compact space-y-3">
      <RegistrationPageHeader
        title="매출등록"
        description={
          <>
            매장 판매(매출)를 등록합니다. 금·14K·18K는 오늘의 매출시세 기준으로 판매가가
            자동 계산되며, 저장하면 아래 매출내역에 반영됩니다.
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[6.5fr_3.5fr] lg:items-stretch lg:gap-4">
        <section className="relative flex min-h-0 min-w-0 flex-col purchase-ledger-work-card p-3 lg:p-3.5">
          <div className="border-b border-[var(--border)] py-2">
            <div className="min-w-0 text-left">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-sm font-medium leading-snug text-[var(--foreground)]">
                  오늘의 매출시세
                </span>
                <span className="text-sm font-medium leading-snug text-[var(--muted)]">
                  (원/돈·24K)
                </span>
                {isAdmin ? (
                  salesPriceEditing ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void saveSalesGoldPriceToServer()}
                        disabled={salesPriceSaving || salesPriceLoading}
                        className={`${headerPriceChip} toss-btn-primary shrink-0`}
                      >
                        {salesPriceSaving ? "저장 중…" : "저장"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditSalesPrice}
                        disabled={salesPriceSaving}
                        className={`${headerPriceChip} toss-btn-secondary shrink-0`}
                      >
                        취소
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startEditSalesPrice}
                      disabled={salesPriceLoading}
                      className={`${headerPriceChip} toss-btn-secondary shrink-0`}
                    >
                      수정
                    </button>
                  )
                ) : null}
              </div>
              {salesPriceEditing && isAdmin ? (
                <input
                  id="inv-sales-quote"
                  value={formatWonInputDisplay(salesGoldPricePerDon)}
                  onChange={(e) => {
                    setSalesGoldPricePerDon(
                      sanitizeWonInputDigits(e.target.value),
                    );
                  }}
                  className="toss-input mt-2 h-11 w-full max-w-[14rem] px-2 text-2xl font-bold tabular-nums leading-none text-[var(--foreground)]"
                  placeholder={salesPriceLoading ? "불러오는 중…" : "520,000"}
                  inputMode="numeric"
                  autoFocus
                />
              ) : (
                <p className="mt-1.5 text-3xl font-bold tabular-nums leading-none tracking-tight text-[var(--foreground)] sm:text-4xl">
                  {salesPriceLoading
                    ? "…"
                    : salesGoldPricePerDon.trim()
                      ? formatWonInputDisplay(salesGoldPricePerDon)
                      : "—"}
                </p>
              )}
              <p className="mt-2 text-xs leading-snug text-[var(--muted)]">
                {isAdmin
                  ? "서버 저장 · 전 매장 공통 · 금·18K·14K 판매가 자동 계산"
                  : "서버 시세 · 관리자만 수정"}
                {salesPriceSaveHint ? (
                  <span className="text-positive font-medium"> · 저장됨</span>
                ) : null}
                {serverSalesGoldPriceDigits == null &&
                !salesGoldPricePerDon.trim() ? (
                  <span className="text-[var(--foreground)]">
                    {" "}
                    · 오늘 시세가 아직 등록되지 않았습니다.
                  </span>
                ) : null}
              </p>
              <div className="mt-1.5">
                <HelpTooltip label="매출등록 도움말" trigger="text">
                  {salesFormHintTooltip}
                </HelpTooltip>
              </div>
            </div>
          </div>

          {(is14KEarringSelected ||
            showPiercingSellPriceBanner ||
            isGoldRingSelected ||
            showSellDiscountBlock ||
            isGoldBarSelected) ? (
            <div className="flex flex-wrap items-start gap-2 py-2 lg:gap-3">
              {is14KEarringSelected ? (
                <div className={discountPanel}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-semibold">판매가 할인</div>
                    <div className="text-[10px] font-medium text-[var(--muted)]">
                      피어싱 선택 · 할인 1만/2만
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-center tabular-nums">
                    <button
                      type="button"
                      disabled={hasWeightInput}
                      onClick={() => {
                        sellPriceUserEditedRef.current = true;
                        setSellPrice(
                          sanitizeWonInputDigits(
                            String(
                              truncateWonToThousands(
                                100_000 * (quantityNum ?? 1),
                              ),
                            ),
                          ),
                        );
                      }}
                      className={discountChipInactive}
                      title={
                        hasWeightInput
                          ? "중량이 입력되어 있으면 피어싱(10만원) 선택을 사용할 수 없습니다"
                          : "피어싱 판매가(10만원) 적용"
                      }
                    >
                      <div className="text-[var(--muted)]">피어싱</div>
                      <div className="font-bold">10만원</div>
                    </button>
                    <button
                      type="button"
                      disabled={!canApplySuggestedSellDiscount}
                      onClick={() => applySellDiscount(10_000)}
                      className={
                        sellDiscountSelectedWon === 10_000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">할인</div>
                      <div className="font-bold">1만원</div>
                    </button>
                    <button
                      type="button"
                      disabled={!canApplySuggestedSellDiscount}
                      onClick={() => applySellDiscount(20_000)}
                      className={
                        sellDiscountSelectedWon === 20_000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">할인</div>
                      <div className="font-bold">2만원</div>
                    </button>
                  </div>
                </div>
              ) : showPiercingSellPriceBanner ? (
                <button
                  type="button"
                  onClick={() => {
                    sellPriceUserEditedRef.current = true;
                    setSellPrice(
                      sanitizeWonInputDigits(
                        String(
                          truncateWonToThousands(100_000 * (quantityNum ?? 1)),
                        ),
                      ),
                    );
                  }}
                  className={`${discountPanel} toss-btn-secondary text-center text-sm font-semibold`}
                  title="클릭하면 판매가에 100,000원이 입력됩니다"
                >
                  <span className="block">피어싱 판매가 10만원</span>
                  <span className="mt-0.5 block text-[10px] font-medium text-[var(--muted)]">
                    클릭하면 판매가에 자동 입력
                  </span>
                </button>
              ) : null}
              {isGoldRingSelected ? (
                <div className={discountPanel}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-semibold">판매가 할인</div>
                    <div className="text-[10px] font-medium text-[var(--muted)]">
                      돌반지 + 할인 1만/2만
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-center tabular-nums">
                    <button
                      type="button"
                      disabled={goldRingBaselineSellWon == null}
                      onClick={() => {
                        setDolRingLaborZero((v) => {
                          const next = !v;
                          if (next) {
                            applyGoldRingSellPriceFromTodayQuote();
                          } else {
                            sellPriceUserEditedRef.current = true;
                            setSellPrice(sanitizeWonInputDigits("0"));
                          }
                          return next;
                        });
                        setGoldRingDiscountSelectedWon(null);
                      }}
                      className={
                        dolRingLaborZero ? discountChipActive : discountChipInactive
                      }
                      title="한 번 누르면 공임 0원, 다시 누르면 원복"
                    >
                      <div className="text-[var(--muted)]">돌반지</div>
                      <div className="font-bold">적용</div>
                    </button>
                    <button
                      type="button"
                      disabled={goldRingBaselineSellWon == null || dolRingLaborZero}
                      onClick={() => applyGoldRingDiscount(10_000)}
                      className={
                        goldRingDiscountSelectedWon === 10_000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">할인</div>
                      <div className="font-bold">1만원</div>
                    </button>
                    <button
                      type="button"
                      disabled={goldRingBaselineSellWon == null || dolRingLaborZero}
                      onClick={() => applyGoldRingDiscount(20_000)}
                      className={
                        goldRingDiscountSelectedWon === 20_000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">할인</div>
                      <div className="font-bold">2만원</div>
                    </button>
                  </div>
                </div>
              ) : null}
              {showSellDiscountBlock ? (
                <div className={discountPanel}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-semibold">판매가 할인</div>
                    <div className="text-[10px] font-medium text-[var(--muted)]">
                      계산된 판매가 기준 1만·2만·3만 중 택일(총 할인 최대 3만원)
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-center tabular-nums">
                    <button
                      type="button"
                      disabled={!canApplySuggestedSellDiscount}
                      onClick={() => applySellDiscount(10_000)}
                      className={
                        sellDiscountSelectedWon === 10_000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">할인</div>
                      <div className="font-bold">1만원</div>
                    </button>
                    <button
                      type="button"
                      disabled={!canApplySuggestedSellDiscount}
                      onClick={() => applySellDiscount(20_000)}
                      className={
                        sellDiscountSelectedWon === 20_000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">할인</div>
                      <div className="font-bold">2만원</div>
                    </button>
                    <button
                      type="button"
                      disabled={!canApplySuggestedSellDiscount}
                      onClick={() => applySellDiscount(30_000)}
                      className={
                        sellDiscountSelectedWon === 30_000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">할인</div>
                      <div className="font-bold">3만원</div>
                    </button>
                  </div>
                </div>
              ) : null}
              {isGoldBarSelected ? (
                <div className={discountPanel}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-semibold">골드바 판매가 참고</div>
                    <div className="text-[10px] font-medium text-[var(--muted)]">
                      마진 계산용 · 10돈 이상·특이중량은 전화문의 · 클릭하면 판매가 반영
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-center tabular-nums">
                    <button
                      type="button"
                      onClick={() => applyGoldBarLaborFee(20000)}
                      className={
                        goldBarSelectedLaborWon === 20000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">1돈</div>
                      <div className="font-bold">20,000원</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyGoldBarLaborFee(30000)}
                      className={
                        goldBarSelectedLaborWon === 30000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">2돈~5돈</div>
                      <div className="font-bold">30,000원</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyGoldBarLaborFee(40000)}
                      className={
                        goldBarSelectedLaborWon === 40000
                          ? discountChipActive
                          : discountChipInactive
                      }
                    >
                      <div className="text-[var(--muted)]">6돈~10돈</div>
                      <div className="font-bold">40,000원</div>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <form
            className="flex min-h-0 flex-1 flex-col pt-1 text-left"
            onSubmit={(e) => e.preventDefault()}
            onKeyDown={handleSalesFormKeyDown}
          >
          <div className="w-full space-y-2 px-0.5 py-0.5 lg:px-1">
          {/*
            고객명 · 전화 — 거래 공통(추가 행이 고객·전화·매장을 따라감).
            명세 12열 그리드와 분리해 입력 폭·정렬을 넓게.
          */}
          <div
            className={`relative border-b border-[var(--border)] pb-3 ${salesRowSidePad}`}
          >
            <div className={salesCustomerRow}>
              <div className={salesCustomerField}>
                <label className={salesCustomerLabel} htmlFor="inv-customer">
                  고객명
                </label>
                <input
                  id="inv-customer"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className={salesCustomerInput}
                  placeholder="선택"
                  autoComplete="name"
                />
              </div>
              <div className={salesCustomerField}>
                <label className={salesCustomerLabel} htmlFor="inv-phone">
                  전화번호
                </label>
                <input
                  id="inv-phone"
                  value={customerPhone}
                  onChange={(e) =>
                    setCustomerPhone(formatMobileInputDisplay(e.target.value))
                  }
                  className={`${salesCustomerInput} tabular-nums`}
                  placeholder="010-0000-0000"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </div>
            </div>
          </div>

            {/* lg+ 헤더 라벨 row */}
            <div className={`relative hidden ${salesRowSidePad} lg:block`}>
              <div
                className={`grid w-full ${salesFormGridCols} gap-x-2 text-center text-xs font-semibold leading-tight text-[var(--foreground)] lg:gap-x-2.5`}
              >
                <span className="truncate">품목</span>
                <span className="truncate">제품코드</span>
                <span className="truncate">제품명</span>
                <span className="truncate">수량</span>
                <span className="truncate">중량(g)</span>
                <span className="truncate">판매가(원)</span>
                <span className="truncate">결제</span>
                <span className="truncate">미수</span>
                <span className="truncate">업체명</span>
                <span className="truncate">발주</span>
                <span className="truncate">사이즈</span>
                <span className="truncate">특이사항</span>
              </div>
            </div>

            {/* 첫 행 */}
            <div className={`relative ${salesRowSidePad}`}>
            <div className={`grid grid-cols-2 ${salesFormGridGap} ${salesFormGridWrap} lg:items-start`}>
              {/* 품목 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`} htmlFor="inv-kind">
                  품목
                </label>
                <select
                  id="inv-kind"
                  value={kind}
                  onChange={(e) => {
                    const next = e.target.value;
                    setKind(next);
                    sellPriceUserEditedRef.current = false;
                    if (
                      next !== "gold" &&
                      next !== "gold_18k" &&
                      next !== "gold_14k" &&
                      next !== "silver"
                    ) {
                      setProductCodeMode("custom");
                    } else if (productCodeMode === "custom" && name.trim() === "") {
                      setProductCodeMode("preset");
                    }
                  }}
                  className={salesSelect}
                >
                  {SALES_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* 제품코드 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>제품코드</label>
                {productCodePresets ? (
                  <div className="flex min-w-0 flex-col gap-1">
                    <select
                      id="inv-product-code"
                      value={
                        productCodeMode === "custom"
                          ? "__custom__"
                          : productCodePresets.some((p) => p === (name as string))
                            ? name
                            : ""
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__custom__") {
                          setProductCodeMode("custom");
                          return;
                        }
                        setProductCodeMode("preset");
                        setName(v);
                      }}
                      className={salesSelect}
                      required={productCodeMode !== "custom"}
                    >
                      <option value="" disabled>
                        선택
                      </option>
                      {productCodePresets.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                      <option value="__custom__">직접입력</option>
                    </select>
                    {productCodeMode === "custom" ? (
                      <input
                        aria-label="제품코드 직접입력"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={salesInputProductCode}
                        placeholder="코드"
                        autoComplete="off"
                        required
                      />
                    ) : null}
                  </div>
                ) : (
                  <input
                    id="inv-product-code"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={salesInputProductCode}
                    placeholder="코드"
                    autoComplete="off"
                  />
                )}
              </div>
              {/* 제품명 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>제품명</label>
                <input
                  id="inv-product-name"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className={salesInput}
                  placeholder="직접 입력"
                />
              </div>
              {/* 수량 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>수량</label>
                <input
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={salesInputNum}
                  placeholder="1"
                  inputMode="decimal"
                />
              </div>
              {/* 중량 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>중량(g)</label>
                <input
                  value={weightG}
                  onChange={(e) => setWeightG(e.target.value)}
                  className={salesInputNum}
                  placeholder="선택"
                  inputMode="decimal"
                />
              </div>
              {/* 판매가 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>판매가(원)</label>
                <input
                  id="inv-sell-price"
                  value={formatWonInputDisplay(sellPrice)}
                  onChange={(e) => {
                    sellPriceUserEditedRef.current = true;
                    const digits = sanitizeWonInputDigits(e.target.value);
                    setSellPrice(digits);
                    setSellDiscountSelectedWon(null);
                    setGoldRingDiscountSelectedWon(null);
                  }}
                  onBlur={() => {
                    const trimmed = sellPrice.trim();
                    if (trimmed === "") {
                      sellPriceUserEditedRef.current = false;
                      if (
                        suggestedSellWonTotal != null &&
                        suggestedSellWonTotal > 0
                      ) {
                        setSellPrice(
                          String(truncateWonToThousands(suggestedSellWonTotal)),
                        );
                      }
                      return;
                    }
                    const n = parseWonDigitsToNumber(sellPrice);
                    if (n == null || !Number.isFinite(n)) return;
                    setSellPrice(
                      sanitizeWonInputDigits(String(truncateWonToThousands(n))),
                    );
                  }}
                  className={salesInputNum}
                  placeholder={
                    suggestedSellWonTotal != null && suggestedSellWonTotal > 0
                      ? `자동 ${formatKRW(suggestedSellWonTotal)}`
                      : "1,000,000"
                  }
                  inputMode="numeric"
                  title={
                    suggestedSellWonTotal != null && suggestedSellWonTotal > 0
                      ? `자동 계산값: ${formatKRW(suggestedSellWonTotal)} — 직접 수정·할인 가능`
                      : undefined
                  }
                />
              </div>
              {/* 결제 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>결제</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={salesSelect}
                >
                  {PAYMENT_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              {/* 미수 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>미수</label>
                <div className="flex min-w-0 flex-col gap-1">
                  <select
                    value={receivableMode}
                    onChange={(e) => {
                      const v = e.target.value as ReceivableMode;
                      setReceivableMode(v);
                      if (v === "완불") setReceivableWonDigits("");
                    }}
                    className={salesSelect}
                  >
                    {RECEIVABLE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  {receivableMode === "직접입력" ? (
                    <input
                      aria-label="미수금(원)"
                      value={formatWonInputDisplay(receivableWonDigits)}
                      onChange={(e) =>
                        setReceivableWonDigits(sanitizeWonInputDigits(e.target.value))
                      }
                      className={salesInputNum}
                      placeholder="미수금"
                      inputMode="numeric"
                    />
                  ) : null}
                </div>
              </div>
              {/* 업체명 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>업체명</label>
                <input
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  className={salesInput}
                  placeholder="선택"
                />
              </div>
              {/* 발주 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>발주</label>
                <select
                  id="inv-fulfillment"
                  value={fulfillmentStatus}
                  onChange={(e) => setFulfillmentStatus(e.target.value)}
                  className={`${salesSelect} ${fulfillmentSelectToneClass(fulfillmentStatus)}`}
                >
                  {FULFILLMENT_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* 사이즈 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>사이즈</label>
                <input
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className={salesInput}
                  placeholder="선택"
                />
              </div>
              {/* 특이사항 */}
              <div className={`${salesField} lg:gap-0`}>
                <label className={`${salesLabel} lg:hidden`}>특이사항</label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={salesInputNote}
                  placeholder="선택"
                />
              </div>
            </div>
            </div>

            {/* 추가 행들 — 같은 거래, 명세만 다름 */}
            {extraSalesRows.map((r, idx) => {
              const rowLabelIdx = idx + 2;
              const isCustomCode = r.productCodeMode === "custom";
              const presetList = productCodePresetsFor(r.kind);
              return (
                <div
                  key={r.rid}
                  className={`relative ${salesRowSidePad}`}
                >
                <div
                  className={`grid grid-cols-2 ${salesFormGridGap} ${salesFormGridWrap} lg:items-start`}
                >
                  {/* 품목 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>
                      {rowLabelIdx}번째 품목
                    </label>
                    <select
                      value={r.kind}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateExtraSalesRow(r.rid, {
                          kind: v,
                          productCodeMode:
                            v === "gold" ||
                            v === "gold_18k" ||
                            v === "gold_14k" ||
                            v === "silver"
                              ? "preset"
                              : "custom",
                          name: "",
                        });
                      }}
                      className={salesSelect}
                    >
                      {SALES_KIND_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* 제품코드 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>제품코드</label>
                    {presetList ? (
                      <div className="flex min-w-0 flex-col gap-1">
                        <select
                          value={
                            isCustomCode
                              ? "__custom__"
                              : presetList.some((p) => p === r.name)
                                ? r.name
                                : ""
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__custom__") {
                              updateExtraSalesRow(r.rid, { productCodeMode: "custom" });
                              return;
                            }
                            updateExtraSalesRow(r.rid, {
                              productCodeMode: "preset",
                              name: v,
                            });
                          }}
                          className={salesSelect}
                          required={!isCustomCode}
                        >
                          <option value="" disabled>
                            선택
                          </option>
                          {presetList.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                          <option value="__custom__">직접입력</option>
                        </select>
                        {isCustomCode ? (
                          <input
                            aria-label={`${rowLabelIdx}번째 제품코드 직접입력`}
                            value={r.name}
                            onChange={(e) =>
                              updateExtraSalesRow(r.rid, { name: e.target.value })
                            }
                            className={salesInputProductCode}
                            placeholder="코드"
                            autoComplete="off"
                            required
                          />
                        ) : null}
                      </div>
                    ) : (
                      <input
                        required
                        value={r.name}
                        onChange={(e) =>
                          updateExtraSalesRow(r.rid, { name: e.target.value })
                        }
                        className={salesInputProductCode}
                        placeholder="코드"
                        autoComplete="off"
                      />
                    )}
                  </div>
                  {/* 제품명 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>제품명</label>
                    <input
                      value={r.productName}
                      onChange={(e) =>
                        updateExtraSalesRow(r.rid, { productName: e.target.value })
                      }
                      className={salesInput}
                      placeholder="직접 입력"
                    />
                  </div>
                  {/* 수량 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>수량</label>
                    <input
                      value={r.quantity}
                      onChange={(e) =>
                        updateExtraSalesRow(r.rid, { quantity: e.target.value })
                      }
                      className={salesInputNum}
                      placeholder="1"
                      inputMode="decimal"
                    />
                  </div>
                  {/* 중량 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>중량(g)</label>
                    <input
                      value={r.weightG}
                      onChange={(e) =>
                        updateExtraSalesRow(r.rid, { weightG: e.target.value })
                      }
                      className={salesInputNum}
                      placeholder="선택"
                      inputMode="decimal"
                    />
                  </div>
                  {/* 판매가 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>판매가(원)</label>
                    <input
                      value={formatWonInputDisplay(r.sellPrice)}
                      onChange={(e) =>
                        updateExtraSalesRow(r.rid, {
                          sellPrice: sanitizeWonInputDigits(e.target.value),
                          sellPriceEdited: true,
                        })
                      }
                      onBlur={() => {
                        const n = parseWonDigitsToNumber(r.sellPrice);
                        if (n == null || !Number.isFinite(n)) return;
                        updateExtraSalesRow(r.rid, {
                          sellPrice: sanitizeWonInputDigits(
                            String(truncateWonToThousands(n)),
                          ),
                          sellPriceEdited: true,
                        });
                      }}
                      className={salesInputNum}
                      placeholder="1,000,000"
                      inputMode="numeric"
                    />
                  </div>
                  {/* 결제 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>결제</label>
                    <select
                      value={r.paymentMethod}
                      onChange={(e) =>
                        updateExtraSalesRow(r.rid, { paymentMethod: e.target.value })
                      }
                      className={salesSelect}
                    >
                      {PAYMENT_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* 미수 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>미수</label>
                    <div className="flex min-w-0 flex-col gap-1">
                      <select
                        value={r.receivableMode}
                        onChange={(e) => {
                          const v = e.target.value as ReceivableMode;
                          updateExtraSalesRow(r.rid, {
                            receivableMode: v,
                            ...(v === "완불" ? { receivableWonDigits: "" } : {}),
                          });
                        }}
                        className={salesSelect}
                      >
                        {RECEIVABLE_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      {r.receivableMode === "직접입력" ? (
                        <input
                          aria-label={`${rowLabelIdx}번째 미수금(원)`}
                          value={formatWonInputDisplay(r.receivableWonDigits)}
                          onChange={(e) =>
                            updateExtraSalesRow(r.rid, {
                              receivableWonDigits: sanitizeWonInputDigits(
                                e.target.value,
                              ),
                            })
                          }
                          className={salesInputNum}
                          placeholder="미수금"
                          inputMode="numeric"
                        />
                      ) : null}
                    </div>
                  </div>
                  {/* 업체명 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>업체명</label>
                    <input
                      value={r.vendorName}
                      onChange={(e) =>
                        updateExtraSalesRow(r.rid, { vendorName: e.target.value })
                      }
                      className={salesInput}
                      placeholder="선택"
                    />
                  </div>
                  {/* 발주 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>발주</label>
                    <select
                      value={r.fulfillmentStatus}
                      onChange={(e) =>
                        updateExtraSalesRow(r.rid, {
                          fulfillmentStatus: e.target.value,
                        })
                      }
                      className={`${salesSelect} ${fulfillmentSelectToneClass(r.fulfillmentStatus)}`}
                    >
                      {FULFILLMENT_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* 사이즈 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>사이즈</label>
                    <input
                      value={r.size}
                      onChange={(e) =>
                        updateExtraSalesRow(r.rid, { size: e.target.value })
                      }
                      className={salesInput}
                      placeholder="선택"
                    />
                  </div>
                  {/* 특이사항 */}
                  <div className={`${salesField} lg:gap-0`}>
                    <label className={`${salesLabel} lg:hidden`}>특이사항</label>
                    <input
                      value={r.note}
                      onChange={(e) =>
                        updateExtraSalesRow(r.rid, { note: e.target.value })
                      }
                      className={salesInputNote}
                      placeholder="선택"
                    />
                  </div>
                </div>
                  <button
                    type="button"
                    onClick={() => removeExtraSalesRow(r.rid)}
                    title={`${rowLabelIdx}번째 명세 삭제`}
                    className="absolute right-0 top-0 flex h-9 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {/* 총 매출 + 줄추가 + 등록 */}
          <div className="flex w-full flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <label
                className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]"
                title={
                  hasPrevCustomer
                    ? "아래 매출내역에서 이 매장 기준 가장 최근 등록된 고객명·전화번호를 넣습니다"
                    : "같은 매장 매출이 내역에 한 건 이상 있어야 합니다"
                }
              >
                <input
                  type="checkbox"
                  checked={reusePrevCustomer}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setReusePrevCustomer(next);
                    if (next && recentCustomerFromLedger) {
                      setCustomerName(recentCustomerFromLedger.name);
                      setCustomerPhone(
                        recentCustomerFromLedger.phone
                          ? formatMobileInputDisplay(recentCustomerFromLedger.phone)
                          : "",
                      );
                    }
                  }}
                  disabled={!hasPrevCustomer}
                  className="rounded border-[var(--border)] text-amber-700 focus:ring-amber-500 disabled:opacity-40"
                />
                직전거래
              </label>
              <button
                type="button"
                onClick={addExtraSalesRow}
                disabled={
                  saving ||
                  staffNeedsBranch ||
                  !effectiveBranchId ||
                  (isAdmin && shopBranches.length === 0)
                }
                className="toss-btn-secondary toss-btn-sm shrink-0 disabled:opacity-50"
                title="같은 거래에 다른 명세를 추가합니다 (고객명·전화·매장은 위와 동일)"
              >
                + 줄추가
              </button>
              {extraSalesRows.length > 0 ? (
                <div className="inline-flex shrink-0 items-center gap-2 toss-chip-sum px-2.5 py-1">
                  <span className="whitespace-nowrap text-[10px] font-semibold text-[var(--muted)]">
                    총 매출
                    <span className="ml-0.5 font-normal text-[var(--muted)]">
                      ({extraSalesRows.length + 1}건)
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-sm font-bold tabular-nums tracking-tight text-[var(--foreground)]">
                    {formatKRW(salesTotalSumWon)}
                  </span>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              id="inv-sales-register-submit"
              disabled={
                saving ||
                staffNeedsBranch ||
                !effectiveBranchId ||
                (isAdmin && shopBranches.length === 0)
              }
              onClick={() => void handleAdd()}
              className="toss-btn-primary toss-btn-md shrink-0 tracking-wide disabled:opacity-50"
            >
              {saving
                ? "저장 중…"
                : extraSalesRows.length > 0
                  ? `등록 (${extraSalesRows.length + 1}건)`
                  : "등록"}
            </button>
          </div>
          </form>
        </section>

        <DailyVaultPanel
          branchId={effectiveBranchId ?? ""}
          branches={branches}
          isAdmin={isAdmin}
          listLoading={loading}
          ledgerFromDate={fromDate}
          ledgerToDate={toDate}
          refreshKey={`${effectiveBranchId ?? ""}-${rows.length}-${loading}`}
        />
      </div>
      </div>

      <section className="purchase-ledger-work-card flex min-h-[50vh] w-full flex-col overflow-hidden lg:min-h-[calc(100dvh-13rem)]">
        <div className="flex w-full min-w-0 shrink-0 flex-nowrap items-center gap-1">
          <h2 className="shrink-0 text-xs font-bold tracking-tight text-[#191f28] dark:text-[var(--foreground)]">
            매출내역
          </h2>
          <span className="shrink-0 text-[10px] font-semibold text-[#8b95a1]">날짜</span>
          <button
            type="button"
            onClick={() => setSalesLedgerDateSortAsc(true)}
            title="오름차순"
            className={`${purchaseLedgerToolbarPill(salesLedgerDateSortAsc)} shrink-0`}
          >
            오름차순
          </button>
          <button
            type="button"
            onClick={() => setSalesLedgerDateSortAsc(false)}
            title="내림차순"
            className={`${purchaseLedgerToolbarPill(!salesLedgerDateSortAsc)} shrink-0`}
          >
            내림차순
          </button>
          <button
            type="button"
            onClick={() => setSalesLedgerTodayOnly((v) => !v)}
            className={`${purchaseLedgerToolbarPill(salesLedgerTodayOnly)} shrink-0`}
          >
            오늘만
          </button>
          <button
            type="button"
            onClick={() => setSalesLedgerUnshippedOnly((v) => !v)}
            className={`${purchaseLedgerToolbarPill(salesLedgerUnshippedOnly)} shrink-0`}
          >
            미출고
          </button>
          <div className="relative ml-2.5 shrink-0">
            <input
              type="search"
              value={salesLedgerSearch}
              onChange={(e) => setSalesLedgerSearch(e.target.value)}
              placeholder="고객명·전화·제품명 (전체 검색)"
              aria-label="고객명·전화번호·제품명으로 매출내역 전체 검색"
              title="입력하면 조회 기간을 무시하고 내 매출 전체에서 매칭합니다"
              className={`${purchaseLedgerToolbarField} w-[12rem] shrink-0 !px-2.5 !pr-7`}
            />
            {salesLedgerSearch ? (
              <button
                type="button"
                onClick={() => setSalesLedgerSearch("")}
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
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="시작일"
            title="시작일"
            className={`${purchaseLedgerToolbarField} w-[7rem] max-w-[7rem] shrink-0 !px-1.5`}
          />
          <span className="shrink-0 text-xs text-[#8b95a1]">~</span>
          <input
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
              : salesLedgerTodayOnly ||
                  salesLedgerUnshippedOnly ||
                  salesLedgerSearch.trim().length > 0
                ? `${salesLedgerRows.length}건 · 매출 ${formatKRW(salesLedgerTableSum)} (${[
                    salesLedgerTodayOnly ? "오늘" : "",
                    salesLedgerUnshippedOnly ? "미출고" : "",
                    salesLedgerSearch.trim().length > 0 ? "전체검색" : "",
                  ]
                    .filter(Boolean)
                    .join("·")})`
                : `${salesSummary.count}건 · 매출 ${formatKRW(salesSummary.sum)} (기간)`}
          </p>
        </div>

        <div
          ref={salesLedgerSumRef}
          className="relative min-h-0 flex-1 overflow-auto pt-2"
        >
          <LedgerSelectionSumBar
            rootRef={salesLedgerSumRef}
            clipboardCopy={salesHistoryClipboardCopy}
          />
          <table className="monthly-purchase-ledger-table sales-history-ledger-table ledger-cell-select w-full min-w-0 table-fixed cursor-cell select-none border-separate border-spacing-0 text-center tabular-nums">
            <colgroup>
              <col className="sales-history-col-quote" />
              <col className="sales-history-col-date" />
              <col className="sales-history-col-customer" />
              <col className="sales-history-col-phone" />
              <col className="sales-history-col-kind" />
              <col className="sales-history-col-code" />
              <col className="sales-history-col-product" />
              <col className="sales-history-col-qty" />
              <col className="sales-history-col-weight" />
              <col className="sales-history-col-price" />
              <col className="sales-history-col-payment" />
              <col className="sales-history-col-deposit" />
              <col className="sales-history-col-receivable" />
              <col className="sales-history-col-vendor" />
              <col className="sales-history-col-fulfillment" />
              <col className="sales-history-col-size" />
              <col className="sales-history-col-io" />
              {isAdmin ? <col className="sales-history-col-edit" /> : null}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f2f4f6] font-semibold text-[#8b95a1] shadow-[0_1px_0_0_#e8ebef] dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)] dark:shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th
                  className="sales-history-col-quote whitespace-nowrap"
                  title="등록 당시 저장된 오늘의 매출시세(원/돈). 금·14K·18K는 금시세, 은은 은시세."
                >
                  매출시세
                </th>
                <th className="sales-history-col-date whitespace-nowrap">날짜</th>
                <th className="sales-history-col-customer whitespace-nowrap">고객명</th>
                <th className="sales-history-col-phone whitespace-nowrap">전화</th>
                <th className="sales-history-col-kind whitespace-nowrap">품목</th>
                <th className="sales-history-col-code whitespace-nowrap">코드</th>
                <th className="sales-history-col-product whitespace-nowrap">제품명</th>
                <th className="sales-history-col-qty whitespace-nowrap">수량</th>
                <th className="sales-history-col-weight whitespace-nowrap">중량(g)</th>
                <th className="sales-history-col-price whitespace-nowrap">판매가</th>
                <th className="sales-history-col-payment whitespace-nowrap">결제</th>
                <th className="sales-history-col-deposit whitespace-nowrap">받은금액</th>
                <th className="sales-history-col-receivable whitespace-nowrap">미수</th>
                <th className="sales-history-col-vendor whitespace-nowrap">업체명</th>
                <th className="sales-history-col-fulfillment whitespace-nowrap">발주</th>
                <th className="sales-history-col-size whitespace-nowrap">사이즈</th>
                <th className="sales-history-col-io whitespace-nowrap">주문/입출고</th>
                {isAdmin ? (
                  <th className="sales-history-col-edit whitespace-nowrap px-0.5 py-1">
                    수정
                  </th>
                ) : null}
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
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableColSpan}
                    className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    등록된 매출이 없습니다.
                  </td>
                </tr>
              ) : rowsInPeriod.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableColSpan}
                    className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    이 기간에 매출이 없습니다.
                  </td>
                </tr>
              ) : salesLedgerRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableColSpan}
                    className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    {salesLedgerSearch.trim().length > 0
                      ? `“${salesLedgerSearch.trim()}” 검색 결과가 없습니다.`
                      : `오늘(${todayYmdSeoul()}) 등록된 매출이 없습니다.`}
                  </td>
                </tr>
              ) : (
                salesLedgerRows.map((r, i) => {
                  const prev = i > 0 ? salesLedgerRows[i - 1] : null;
                  const sold = r.sold_at ?? r.updated_at;
                  const ledgerDt = dailyLedgerDateCellParts(sold);
                  const ymd = seoulYmdFromIso(sold);
                  const prevSold = prev != null ? prev.sold_at ?? prev.updated_at : null;
                  const prevYmd =
                    prevSold != null ? seoulYmdFromIso(prevSold) : null;
                  const showDate = prevYmd == null || ymd !== prevYmd;
                  const entryPricePerDon = inventoryEntrySalesPricePerDon(r);
                  const phoneFull =
                    r.customer_phone?.trim()
                      ? normalizeKoreanMobilePhone(r.customer_phone)
                      : "";
                  const phoneDisp = phoneFull;
                  const qtyDisp = String(r.quantity);
                  const weightNum =
                    r.weight_g != null ? Number(r.weight_g) : NaN;
                  const weightSumAttr =
                    Number.isFinite(weightNum) ? String(weightNum) : null;
                  const sellNum =
                    r.sell_price != null ? Number(r.sell_price) : NaN;
                  const sellRounded =
                    Number.isFinite(sellNum) ? Math.round(sellNum) : null;
                  const receivableWon =
                    r.receivable_won != null &&
                    Number.isFinite(Number(r.receivable_won))
                      ? Math.round(Number(r.receivable_won))
                      : 0;
                  const hasReceivable = receivableWon > 0;
                  const depositWon =
                    r.deposit_won != null && Number.isFinite(Number(r.deposit_won))
                      ? Math.round(Number(r.deposit_won))
                      : 0;
                  const hasDeposit = depositWon > 0;
                  const inDisp = ledgerReceivedDisplay(r);
                  const outDisp = ledgerShippedDisplay(r);
                  const orderDisp = ledgerOrderRefDisplay(r);
                  const inDone = inDisp.trim() === "완";
                  const outDone = outDisp.trim() === "완";
                  const orderDone = orderDisp.trim() === "완";
                  return (
                    <tr
                      key={r.id}
                      data-ledger-row={r.id}
                      className="hover:bg-gray-100/80 dark:bg-gray-800/40"
                    >
                      <td
                        className="sales-history-col-quote tabular-nums text-[var(--foreground)]"
                        data-clipboard-text={
                          entryPricePerDon != null
                            ? entryPricePerDon.toLocaleString("ko-KR")
                            : ""
                        }
                        title={
                          entryPricePerDon != null
                            ? entryPricePerDon.toLocaleString("ko-KR")
                            : undefined
                        }
                      >
                        {entryPricePerDon != null
                          ? entryPricePerDon.toLocaleString("ko-KR")
                          : "—"}
                      </td>
                      <td
                        className="sales-history-col-date tabular-nums text-[var(--foreground)]"
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
                      <td
                        className="sales-history-col-customer text-[var(--foreground)]"
                        title={r.customer_name?.trim() || undefined}
                      >
                        {r.customer_name?.trim() ? r.customer_name : "—"}
                      </td>
                      <td
                        className="sales-history-col-phone text-[var(--foreground)]"
                        data-clipboard-text={phoneFull || ""}
                        title={phoneFull || undefined}
                      >
                        {phoneDisp || "—"}
                      </td>
                      <td className="sales-history-col-kind text-[var(--foreground)]">
                        {kindLabel(r.kind)}
                      </td>
                      <td
                        className="sales-history-col-code font-medium text-[var(--foreground)]"
                        title={r.name || undefined}
                      >
                        {r.name}
                      </td>
                      <td
                        className="sales-history-col-product text-[var(--foreground)]"
                        data-ledger-preview-label="제품명"
                        data-ledger-preview-value={
                          r.product_name?.trim() ? r.product_name : undefined
                        }
                        data-clipboard-text={r.product_name?.trim() || ""}
                        title={r.product_name?.trim() || undefined}
                      >
                        {r.product_name?.trim() ? r.product_name : "—"}
                      </td>
                      <td className="sales-history-col-qty tabular-nums text-[var(--foreground)]">
                        {qtyDisp}
                      </td>
                      <td
                        className="sales-history-col-weight tabular-nums text-[var(--foreground)]"
                        {...(weightSumAttr != null
                          ? { "data-sum-g": weightSumAttr }
                          : {})}
                      >
                        {r.weight_g != null && Number.isFinite(Number(r.weight_g))
                          ? r.weight_g
                          : "—"}
                      </td>
                      <td
                        className="sales-history-col-price font-medium tabular-nums text-[var(--foreground)]"
                        title={
                          sellRounded != null ? formatKRW(sellRounded) : undefined
                        }
                        {...(sellRounded != null
                          ? { "data-sum-won": String(sellRounded) }
                          : {})}
                      >
                        {sellRounded != null ? formatKRW(sellRounded) : "—"}
                      </td>
                      <td
                        className="sales-history-col-payment text-[var(--foreground)]"
                        title={r.payment_method?.trim() || undefined}
                      >
                        {r.payment_method?.trim() ? r.payment_method : "—"}
                      </td>
                      <td
                        className="sales-history-col-deposit tabular-nums text-[var(--foreground)]"
                        title={hasDeposit ? formatKRW(depositWon) : undefined}
                        {...(hasDeposit
                          ? { "data-sum-won": String(depositWon) }
                          : {})}
                      >
                        {depositLedgerDisplay(r)}
                      </td>
                      <td
                        className={`sales-history-col-receivable tabular-nums ${
                          hasReceivable
                            ? "font-semibold text-rose-700"
                            : "text-[var(--foreground)]"
                        }`}
                        title={
                          hasReceivable ? formatKRW(receivableWon) : undefined
                        }
                        {...(hasReceivable
                          ? { "data-sum-won": String(receivableWon) }
                          : {})}
                      >
                        {receivableLedgerDisplay(r)}
                      </td>
                      <td
                        className="sales-history-col-vendor text-[var(--foreground)]"
                        title={r.vendor_name?.trim() || undefined}
                      >
                        {r.vendor_name?.trim() ? r.vendor_name : "—"}
                      </td>
                      <td
                        className="sales-history-col-fulfillment font-medium text-[var(--foreground)]"
                        title={fulfillmentLabel(r.fulfillment_status)}
                      >
                        {fulfillmentLabel(r.fulfillment_status)}
                      </td>
                      <td
                        className="sales-history-col-size text-[var(--foreground)]"
                        title={r.size?.trim() || undefined}
                      >
                        {r.size?.trim() ? r.size : "—"}
                      </td>
                      <td
                        className="sales-history-col-io text-[var(--foreground)]"
                        data-clipboard-text={`${orderDisp || "–"}/${inDisp || "–"}/${outDisp || "–"}`}
                      >
                        <div className="sales-history-io-row flex w-full items-center">
                          <input
                            key={`${r.id}-order-${orderDisp}`}
                            defaultValue={orderDisp}
                            maxLength={1}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              (e.currentTarget as HTMLInputElement).blur();
                            }}
                            onBlur={(e) =>
                              void saveLedgerOrderRef(r, e.target.value)
                            }
                            className={`sales-history-io-input rounded border px-0.5 py-0.5 text-center text-[10px] font-semibold leading-none outline-none focus:ring-1 ${
                              orderDone
                                ? "border-violet-400 bg-violet-100 text-violet-950 focus:border-violet-500 focus:ring-violet-400/35"
                                : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:border-amber-500 focus:ring-amber-400/35"
                            }`}
                            placeholder="완"
                            autoComplete="off"
                            title="주문 완료. 완 입력 후 Enter로 저장."
                          />
                          <button
                            type="button"
                            onClick={() =>
                              void saveLedgerInOutNote(
                                r,
                                "received",
                                inDone ? "" : "완",
                              )
                            }
                            className={`shrink-0 rounded border px-0.5 py-0.5 text-center text-[10px] font-semibold leading-none outline-none transition-colors ${
                              inDone
                                ? "border-sky-400 bg-sky-100 text-sky-950 hover:bg-sky-200"
                                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                            }`}
                            title={
                              inDone
                                ? "입고완료 — 클릭하면 취소"
                                : "클릭하면 입고완료로 표시"
                            }
                          >
                            입고
                          </button>
                          {(() => {
                            const smsSent = Boolean(r.arrival_sms_sent_at);
                            const canSms =
                              inDone && Boolean(r.customer_phone?.trim());
                            return (
                              <button
                                type="button"
                                disabled={!canSms}
                                onClick={() => {
                                  if (!canSms) return;
                                  openArrivalSms(
                                    r.customer_phone ?? "",
                                    buildArrivalSmsBody({
                                      customerName: r.customer_name,
                                      productCode: r.name,
                                      context: "sales",
                                    }),
                                    () => void markArrivalSmsSent(r.id),
                                    {
                                      sourceScope: "inventory",
                                      sourceId: r.id,
                                    },
                                  );
                                }}
                                className={`shrink-0 rounded border px-0.5 py-0.5 text-[10px] leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                  smsSent
                                    ? "border-amber-300 bg-amber-100 font-semibold text-amber-900 hover:bg-amber-200 disabled:hover:bg-amber-100"
                                    : "border-[var(--border)] bg-gray-50 text-[var(--muted)] hover:bg-stone-100 dark:bg-gray-800/60"
                                }`}
                                title={
                                  !canSms
                                    ? "입고완료 후 전화번호가 있을 때 발송 가능"
                                    : smsSent
                                      ? "입고 안내 문자 발송됨 — 다시 누르면 재발송"
                                      : "입고 안내 문자 보내기"
                                }
                              >
                                {smsSent ? "발송" : "문자"}
                              </button>
                            );
                          })()}
                          <input
                            key={`${r.id}-shipped-${outDisp}`}
                            defaultValue={outDisp}
                            maxLength={1}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              (e.currentTarget as HTMLInputElement).blur();
                            }}
                            onBlur={(e) =>
                              void saveLedgerInOutNote(
                                r,
                                "shipped",
                                e.target.value,
                              )
                            }
                            className={`sales-history-io-input rounded border px-0.5 py-0.5 text-center text-[10px] font-semibold leading-none outline-none focus:ring-1 ${
                              outDone
                                ? "border-emerald-400 bg-emerald-100 text-emerald-950 focus:border-emerald-500 focus:ring-emerald-400/35"
                                : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:border-amber-500 focus:ring-amber-400/35"
                            }`}
                            placeholder="완"
                            autoComplete="off"
                            title="출고여부. 완 입력 후 Enter로 저장."
                          />
                        </div>
                      </td>
                      {isAdmin ? (
                        <td className="sales-history-col-edit px-1 py-2 text-xs">
                          <button
                            type="button"
                            onClick={() => setInventoryToEdit(r)}
                            className="monthly-purchase-ledger-margin text-xs hover:underline"
                          >
                            수정
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
            {!loading && salesLedgerRows.length > 0 ? (
              <tfoot className="sticky bottom-0 z-[5] border-t border-[#e8ebef] bg-[#f2f4f6] text-xs font-semibold text-[#191f28] shadow-[0_-1px_0_0_#e8ebef] dark:border-[var(--border)] dark:bg-[var(--surface-subtle)] dark:text-[var(--foreground)]">
                <tr>
                  <td
                    colSpan={9}
                    className="px-2 py-2 text-right text-sm font-bold text-amber-900 dark:text-amber-300"
                  >
                    매출금액 총액
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-sm font-bold tabular-nums text-amber-900 dark:text-amber-300">
                    {formatKRW(salesLedgerTableSum)}
                  </td>
                  <td
                    colSpan={isAdmin ? 7 : 6}
                    className="px-2 py-2"
                  />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <InventoryEditDialog
        supabase={supabase}
        item={inventoryToEdit}
        open={inventoryToEdit != null}
        onClose={() => setInventoryToEdit(null)}
        onSaved={() => {
          void load();
        }}
        userId={profile?.id ?? ""}
        branches={branches}
        profile={profile}
        branchRows={branchRows}
        quoteGoldPerDonDigits={salesGoldPricePerDon}
        quoteSilverPerDonDigits=""
        hideLaborFee
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  branchLabelForId,
  branchSelectRowsForShop,
  branchesForShopSelect,
  firstShopSelectableBranchId,
} from "@/lib/branchLabels";
import {
  formatDateTime,
  formatKRW,
  formatMonthlyLedgerMoDay,
  formatWonInputDisplay,
  localYmdFromIso,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
  seoulYmdFromIso,
  todayYmdSeoul,
  formatLedgerYearLabel,
} from "@/lib/format";
import { buildChangeMap } from "@/lib/purchaseAudit";
import { inventorySaleMetalCostWon } from "@/lib/inventoryMargin";
import { jongroDailyQuotesSetupHint } from "@/lib/purchaseMargin";
import { swrLoad } from "@/lib/queryCache";
import {
  goldQuotePerDonForSalesLedger,
  isCardLedgerPayment,
  isCardOrCashReceiptLedgerPayment,
  salesLedgerEffectiveQuotePerDonForRow,
  salesLedgerGoldQuoteFactor,
  salesLedgerJongroInputDigitsDefault,
  salesLedgerTableDisplayedMarginWon,
} from "@/lib/salesLedgerTableMargin";
import { LedgerSelectionSumBar } from "@/components/LedgerSelectionSumBar";
import { InventoryEditDialog } from "@/components/InventoryEditDialog";
import { DailyBranchProfitPanel } from "@/components/DailyBranchProfitPanel";
import { useAppBootstrap } from "@/components/AppProviders";
import { buildArrivalSmsBody, openArrivalSms } from "@/lib/arrivalSms";
import { matchesLedgerCustomerSearch } from "@/lib/ledgerCustomerSearch";
import { useInventoryLedgerUndo } from "@/lib/useInventoryLedgerUndo";
import {
  JONGRO_QUOTE_SCOPE_GOLD,
  JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER,
  JONGRO_QUOTE_SCOPE_SILVER,
  type Branch,
  type InventoryItem,
  type Profile,
} from "@/types/db";
import {
  isPurchaseVendorName,
  lookupLaborFeeWonForInventoryItem,
  type ProductLaborFeeLookupRow,
} from "@/lib/productLaborFeeMatch";

/** Ctrl/⌘+C 복사 시 첫 줄 헤더(표 열 순서와 동일) */
const SALES_LEDGER_CLIPBOARD_HEADERS = [
  "미수",
  "날짜",
  "고객명",
  "전화번호",
  "제품명",
  "수량",
  "공임",
  "중량(g)",
  "함량",
  "판매가",
  "원가",
  "마진",
  "종로시세",
  "현시세",
  "주문/입출고",
  "업체명",
  "발주",
  "사이즈",
  "결제방식",
] as const;

const SALES_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "gold", label: "24K" },
  { value: "gold_14k", label: "14K" },
  { value: "gold_18k", label: "18K" },
  { value: "silver", label: "은" },
];

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

function kindLabel(value: string) {
  const hit = SALES_KIND_OPTIONS.find((k) => k.value === value);
  if (hit) return hit.label;
  if (value === "other") return "기타";
  return value;
}

function receivableLedgerDisplay(r: InventoryItem): string {
  const w = r.receivable_won != null ? Number(r.receivable_won) : NaN;
  if (Number.isFinite(w) && w > 0) return formatKRW(Math.round(w));
  return "완";
}

function ledgerOrderRefDisplay(r: InventoryItem): string {
  const t = r.order_ref?.trim();
  return t ? t.slice(0, 1) : "";
}

function ledgerReceivedDisplay(r: InventoryItem): string {
  const t = r.received_note?.trim();
  if (t === "완" || t === "완료") return "완";
  if (t) return t.slice(0, 1);
  return r.received ? "완" : "";
}

function ledgerShippedDisplay(r: InventoryItem): string {
  const t = r.shipped_note?.trim();
  if (t === "완" || t === "완료") return "완";
  if (t) return t.slice(0, 1);
  return r.shipped ? "완" : "";
}

function monthRange() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const start = `${y}-${m}-01`;
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endStr = `${y}-${m}-${pad(end.getDate())}`;
  return { from: start, to: endStr };
}

function monthDateRange(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const end = new Date(year, month, 0);
  const to = `${year}-${pad(month)}-${pad(end.getDate())}`;
  return { from, to };
}

/** 월매출장부 함량 표시 */
function hamryangDisplay(r: InventoryItem): string {
  if (r.kind === "silver") return "\uC740";
  if (r.kind === "gold_18k") return "18K";
  if (r.kind === "gold_14k") return "14K";
  if (r.kind === "other") return "\uAE30\uD0C0";
  if (r.purity?.trim()) return r.purity.trim();
  return "24K";
}

function phoneLedgerDisplay(phone: string | null | undefined): string {
  const t = phone?.trim();
  if (!t) return "\u2014";
  if (t.length > 14) return `${t.slice(0, 14)}\u2026`;
  return t;
}

function purchaseLedgerToolbarPill(active: boolean) {
  return active
    ? "tongsang-pill tongsang-pill-active px-3 py-1.5 text-xs"
    : "tongsang-pill tongsang-pill-inactive px-3 py-1.5 text-xs";
}

type QuoteRow = {
  quote_date: string;
  quote_scope: string | null;
  price_per_don: number;
};

export default function SalesLedgerPage() {
  const sumRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const bootstrap = useAppBootstrap();
  const initial = monthRange();
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const LS_YEARS = "goldLedger_salesYearFolders";

  const [profile, setProfile] = useState<Profile | null>(bootstrap.profile);
  const [branches, setBranches] = useState<Branch[]>(bootstrap.branches);
  const [branchId, setBranchId] = useState("");
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [yearFolders, setYearFolders] = useState<number[]>([
    currentYear - 1,
    currentYear,
    currentYear + 1,
  ]);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(
    () => new Date().getMonth() + 1,
  );
  const [view, setView] = useState<"month" | "yearTotal">("month");
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [quoteRows, setQuoteRows] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** 월 매출장부 표: 날짜 정렬(기본 내림차순 = 최신→과거) · 오늘(서울일)만 */
  const [ledgerDateSortAsc, setLedgerDateSortAsc] = useState(false);
  const [ledgerTodayOnly, setLedgerTodayOnly] = useState(false);
  const [ledgerUnshippedOnly, setLedgerUnshippedOnly] = useState(false);
  /** 월 매출장부 표: 결제 카드·현영만 */
  const [ledgerCardCashReceiptOnly, setLedgerCardCashReceiptOnly] =
    useState(false);
  /** 월 매출장부 표: 고객명·전화번호·제품명 검색 */
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [laborEdits, setLaborEdits] = useState<Record<string, string>>({});
  /** 사용자가 공임 칸을 직접 수정한 행 — 자동입력 대상에서 제외 */
  const [laborManualOverrideIds, setLaborManualOverrideIds] = useState<
    Set<string>
  >(() => new Set());
  /** 공임관리(product_labor_fees) 등록 행 — 매출장부 공임 자동입력에 사용. */
  const [laborFeeRows, setLaborFeeRows] = useState<ProductLaborFeeLookupRow[]>(
    [],
  );
  /** 공임 자동입력(일괄) 진행 중 */
  const [autoLaborBusy, setAutoLaborBusy] = useState(false);
  const [jongroQuoteEdits, setJongroQuoteEdits] = useState<Record<string, string>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [updating, setUpdating] = useState(false);
  /** 미수가 있는 행을 출고완료로 바꾸려 할 때 띄우는 확정 모달 */
  const [receivableShipConfirm, setReceivableShipConfirm] = useState<{
    row: InventoryItem;
    receivableWon: number;
    nextNote: string;
  } | null>(null);
  const [receivableShipSaving, setReceivableShipSaving] = useState(false);
  /** 출고 input — 미수 확인 모달 취소 시 defaultValue 되돌리기용 */
  const [shippedInputResetTick, setShippedInputResetTick] = useState(0);

  const showBriefMsg = useCallback((text: string) => {
    setMsg(text);
    if (typeof window !== "undefined") {
      window.setTimeout(() => setMsg(null), 3500);
    }
  }, []);

  const onUndoApplied = useCallback(
    (text: string) => {
      setShippedInputResetTick((v) => v + 1);
      showBriefMsg(text);
    },
    [showBriefMsg],
  );

  const { pushUndo, pushInOutUndo, undoLast, canUndo, snapInOutRow } =
    useInventoryLedgerUndo(supabase, setRows, setError, onUndoApplied);

  const salesLedgerTableColSpan = 20;

  const [processingQuoteDate, setProcessingQuoteDate] = useState(() =>
    todayYmdSeoul(),
  );
  const [processingGoldPriceDigits, setProcessingGoldPriceDigits] = useState("");
  // Silver processing quote input removed from UI (2026-04): silver rows use per-row override.
  const [processingSavedGoldPerDon, setProcessingSavedGoldPerDon] = useState<number | null>(
    null,
  );
  const [processingSavedAt, setProcessingSavedAt] = useState<string | null>(null);
  const [processingQuoteLoading, setProcessingQuoteLoading] = useState(false);
  const [processingApplyBusy, setProcessingApplyBusy] = useState(false);

  const isAdmin = profile?.role === "admin";

  const salesLedgerClipboardCopy = useMemo(
    () => ({
      columnHeaders: SALES_LEDGER_CLIPBOARD_HEADERS,
      /** 월 매출장부: 모든 칸 복사 가능 */
      omitLeadingDataColumns: 0,
      /** 우측 끝 수정 버튼 열은 복사 제외 */
      omitTrailingDataColumns: 1,
    }),
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(LS_YEARS);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const years = parsed
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n >= 2000 && n <= 2100);
      if (years.length) {
        const uniq = Array.from(new Set(years)).sort((a, b) => a - b);
        setYearFolders(uniq);
        if (!uniq.includes(selectedYear)) setSelectedYear(uniq[uniq.length - 1]);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_YEARS, JSON.stringify(yearFolders));
  }, [yearFolders]);

  function addYearFolder(y: number) {
    if (!Number.isFinite(y) || y < 2000 || y > 2100) {
      setError("연도는 2000~2100 사이 숫자로 입력하세요.");
      return;
    }
    setYearFolders((prev) => Array.from(new Set([...prev, y])).sort((a, b) => a - b));
    setSelectedYear(y);
  }

  const quoteByDateScope = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quoteRows) {
      const scope = q.quote_scope ?? JONGRO_QUOTE_SCOPE_GOLD;
      const k = `${q.quote_date}|${scope}`;
      if (q.price_per_don != null && Number.isFinite(Number(q.price_per_don))) {
        m.set(k, Number(q.price_per_don));
      }
    }
    return m;
  }, [quoteRows]);

  /**
   * 매출장부「금 매입시세」입력값은 저장 전이라도 원가/마진 계산에 즉시 반영한다.
   * DB 키는 매입장부 `gold`와 분리된 `gold_sales` 스코프를 쓴다.
   */
  const quoteByDateScopeEffective = useMemo(() => {
    const m = new Map(quoteByDateScope);
    const gold = parseWonDigitsToNumber(processingGoldPriceDigits);
    if (gold != null && Number.isFinite(gold) && gold > 0) {
      m.set(
        `${processingQuoteDate}|${JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER}`,
        Math.round(gold),
      );
    }
    return m;
  }, [
    quoteByDateScope,
    processingQuoteDate,
    processingGoldPriceDigits,
  ]);

  const ledgerDisplayRows = useMemo(() => {
    const ymdToday = todayYmdSeoul();
    let list = [...rows];
    if (ledgerTodayOnly) {
      list = list.filter((r) => {
        const sold = r.sold_at ?? r.updated_at;
        return seoulYmdFromIso(sold) === ymdToday;
      });
    }
    if (ledgerUnshippedOnly) {
      list = list.filter((r) => ledgerShippedDisplay(r).trim() === "");
    }
    if (ledgerCardCashReceiptOnly) {
      list = list.filter((r) =>
        isCardOrCashReceiptLedgerPayment(r.payment_method),
      );
    }
    const q = ledgerSearch.trim();
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
      return ledgerDateSortAsc ? ta - tb : tb - ta;
    });
    return list;
  }, [
    rows,
    ledgerTodayOnly,
    ledgerUnshippedOnly,
    ledgerCardCashReceiptOnly,
    ledgerDateSortAsc,
    ledgerSearch,
  ]);

  // 오름차순(최근이 맨 아래)일 때, 로드 완료 후 맨 아래로 스크롤해 최근 입력이 보이게 한다.
  const didAutoScrollRef = useRef(false);
  useEffect(() => {
    if (loading) {
      didAutoScrollRef.current = false;
      return;
    }
    if (!ledgerDateSortAsc) return;
    if (didAutoScrollRef.current) return;
    const el = sumRef.current;
    if (!el) return;
    didAutoScrollRef.current = true;
    window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [loading, ledgerDateSortAsc, ledgerDisplayRows.length]);

  const ledgerTableSellSum = useMemo(
    () =>
      ledgerDisplayRows.reduce((a, r) => {
        const n = r.sell_price != null ? Number(r.sell_price) : NaN;
        return a + (Number.isFinite(n) ? Math.round(n) : 0);
      }, 0),
    [ledgerDisplayRows],
  );

  const ledgerTableMarginSum = useMemo(() => {
    let sum = 0;
    for (const r of ledgerDisplayRows) {
      const m = salesLedgerTableDisplayedMarginWon(
        r,
        quoteByDateScopeEffective,
        jongroQuoteEdits,
        laborEdits,
      );
      if (m != null) sum += m;
    }
    return sum;
  }, [ledgerDisplayRows, quoteByDateScopeEffective, jongroQuoteEdits, laborEdits]);

  const effectiveBranchId = useMemo(() => {
    if (!profile) return branchId;
    return profile.role === "admin" ? branchId : profile.branch_id || "";
  }, [profile, branchId]);

  const markLaborManualOverride = useCallback((rowId: string) => {
    setLaborManualOverrideIds((prev) => {
      if (prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.add(rowId);
      return next;
    });
  }, []);

  const saveLaborFee = useCallback(
    async (rowId: string, digits: string) => {
      const trimmed = digits.trim();
      const next =
        trimmed.length === 0 ? null : (parseWonDigitsToNumber(trimmed) ?? null);
      const prev = rows.find((r) => r.id === rowId)?.labor_fee ?? null;
      const prevRounded = prev != null && Number.isFinite(Number(prev)) ? Math.round(Number(prev)) : null;
      if (prevRounded === next) {
        setLaborEdits((m) => {
          const { [rowId]: _drop, ...rest } = m;
          return rest;
        });
        return;
      }

      setError(null);
      const updatedAt = new Date().toISOString();
      const { error: ue } = await supabase
        .from("inventory_items")
        .update({ labor_fee: next, updated_at: updatedAt })
        .eq("id", rowId);
      if (ue) {
        setError(ue.message);
        return;
      }
      markLaborManualOverride(rowId);
      setRows((prevRows) =>
        prevRows.map((r) =>
          r.id === rowId ? { ...r, labor_fee: next, updated_at: updatedAt } : r,
        ),
      );
      setLaborEdits((m) => {
        const { [rowId]: _drop, ...rest } = m;
        return rest;
      });
    },
    [rows, supabase, markLaborManualOverride],
  );

  /** 이 지점의 공임관리 제품(제품명→공임) 맵을 불러온다. 제품명 일치 시 공임 자동입력에 사용. */
  const loadLaborFeeMap = useCallback(async () => {
    if (!effectiveBranchId) {
      setLaborFeeRows([]);
      return;
    }
    const { data, error: e } = await supabase
      .from("product_labor_fees")
      .select("product_code, labor_fee_won, weight_g")
      .eq("branch_id", effectiveBranchId);
    if (e || !data) return;
    setLaborFeeRows(data as ProductLaborFeeLookupRow[]);
  }, [supabase, effectiveBranchId]);

  useEffect(() => {
    void loadLaborFeeMap();
  }, [loadLaborFeeMap]);

  /** 행의 제품명·제품코드가 공임관리에 있으면 그 공임(원)을, 없으면 null. */
  const suggestedLaborForRow = useCallback(
    (r: InventoryItem): number | null => {
      if (isPurchaseVendorName(r.vendor_name)) return null;
      return lookupLaborFeeWonForInventoryItem(laborFeeRows, {
        name: r.name,
        product_name: r.product_name,
        weight_g: r.weight_g,
      });
    },
    [laborFeeRows],
  );

  /** 현재 행의 공임이 비어있는지(저장값·편집값 모두 없음). */
  const rowLaborIsEmpty = useCallback(
    (r: InventoryItem): boolean => {
      if (Object.prototype.hasOwnProperty.call(laborEdits, r.id)) {
        return String(laborEdits[r.id] ?? "").trim().length === 0;
      }
      return !(r.labor_fee != null && Number.isFinite(Number(r.labor_fee)));
    },
    [laborEdits],
  );

  /** 공임이 비어있으면서 제품명이 공임표와 일치하는 행 목록(자동입력 대상). */
  const autoFillableLaborRows = useMemo(() => {
    const out: { id: string; fee: number }[] = [];
    for (const r of ledgerDisplayRows) {
      if (laborManualOverrideIds.has(r.id)) continue;
      if (!rowLaborIsEmpty(r)) continue;
      const fee = suggestedLaborForRow(r);
      if (fee == null) continue;
      out.push({ id: r.id, fee });
    }
    return out;
  }, [
    ledgerDisplayRows,
    rowLaborIsEmpty,
    suggestedLaborForRow,
    laborManualOverrideIds,
  ]);

  /** 제품명이 일치하는 빈 공임 행들을 공임표 값으로 일괄 입력·저장한다. */
  const autoFillLaborFees = useCallback(async (opts?: { silent?: boolean }) => {
    if (autoFillableLaborRows.length === 0) return;
    setAutoLaborBusy(true);
    setError(null);
    if (!opts?.silent) setMsg(null);
    const updatedAt = new Date().toISOString();
    const chunkSize = 25;
    let done = 0;
    for (let i = 0; i < autoFillableLaborRows.length; i += chunkSize) {
      const chunk = autoFillableLaborRows.slice(i, i + chunkSize);
      const results = await Promise.all(
        chunk.map(({ id, fee }) =>
          supabase
            .from("inventory_items")
            .update({ labor_fee: fee, updated_at: updatedAt })
            .eq("id", id),
        ),
      );
      for (const res of results) {
        if (res.error) {
          setError(res.error.message);
          setAutoLaborBusy(false);
          return;
        }
        done += 1;
      }
    }
    const feeById = new Map(autoFillableLaborRows.map((x) => [x.id, x.fee]));
    setRows((prev) =>
      prev.map((r) =>
        feeById.has(r.id)
          ? { ...r, labor_fee: feeById.get(r.id) as number, updated_at: updatedAt }
          : r,
      ),
    );
    setLaborEdits((m) => {
      const next = { ...m };
      for (const { id } of autoFillableLaborRows) delete next[id];
      return next;
    });
    setAutoLaborBusy(false);
    if (!opts?.silent) {
      setMsg(`제품명이 공임표와 일치하는 ${done}건의 공임을 자동 입력했습니다.`);
    }
  }, [autoFillableLaborRows, supabase]);

  /**
   * 장부를 열면(또는 매출 등록 후 새로고침되면) 제품명이 공임표와 일치하는
   * "빈 공임" 행을 자동으로 채워 저장한다. 기존에 입력된 공임은 절대 건드리지 않는다.
   * 채우고 나면 그 행은 더 이상 대상이 아니므로 반복 실행되지 않는다.
   */
  const autoLaborRunningRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (laborFeeRows.length === 0) return;
    if (autoFillableLaborRows.length === 0) return;
    if (Object.keys(laborEdits).length > 0) return;
    if (autoLaborRunningRef.current) return;
    autoLaborRunningRef.current = true;
    void (async () => {
      await autoFillLaborFees({ silent: true });
      autoLaborRunningRef.current = false;
    })();
  }, [loading, laborFeeRows, autoFillableLaborRows, autoFillLaborFees, laborEdits]);

  const saveLedgerInOutNote = useCallback(
    async (row: InventoryItem, field: "received" | "shipped", raw: string) => {
      const trimmed = raw.trim();
      const prev =
        field === "received"
          ? ledgerReceivedDisplay(row).trim()
          : ledgerShippedDisplay(row).trim();
      if (trimmed === prev) return;

      if (field === "shipped" && trimmed.length > 0) {
        const receivable =
          row.receivable_won != null ? Number(row.receivable_won) : NaN;
        if (Number.isFinite(receivable) && receivable > 0) {
          // 미수가 있으면 일반 confirm() 대신 명확한 모달을 띄워서 사용자가
          // Enter 한 번에 무심코 넘어가는 사고를 막는다.
          setReceivableShipConfirm({
            row,
            receivableWon: Math.round(receivable),
            nextNote: trimmed === "완" ? "완료" : trimmed,
          });
          return;
        }
      }

      setError(null);
      const updatedAt = new Date().toISOString();
      const payload =
        field === "received"
          ? {
              updated_at: updatedAt,
              received_note: trimmed || null,
              received: trimmed.length > 0,
              ...(trimmed.length === 0
                ? { shipped_note: null as string | null, shipped: false }
                : {}),
            }
          : {
              updated_at: updatedAt,
              shipped_note: (trimmed === "완" ? "완료" : trimmed) || null,
              shipped: trimmed.length > 0,
            };

      const { error: ue } = await supabase
        .from("inventory_items")
        .update(payload)
        .eq("id", row.id);
      if (ue) {
        setError(ue.message);
        return;
      }

      setRows((prevRows) =>
        prevRows.map((r) =>
          r.id === row.id ? { ...r, ...payload, updated_at: updatedAt } : r,
        ),
      );
      pushInOutUndo(row, field, trimmed);
      // 입고완료 시 문자는 자동 발송하지 않는다. '문자' 버튼으로 직접 보내야
      // 발송 여부(버튼 색)를 구분할 수 있다.
    },
    [supabase, pushInOutUndo],
  );

  const saveLedgerOrderRef = useCallback(
    async (row: InventoryItem, raw: string) => {
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
        setError(ue.message);
        return;
      }

      setRows((prevRows) =>
        prevRows.map((r) =>
          r.id === row.id ? { ...r, order_ref, updated_at: updatedAt } : r,
        ),
      );
    },
    [supabase],
  );

  /** 입고 안내 문자 발송 성공 시 호출 — 발송 시각을 저장하고 표에 색으로 표시. */
  const markArrivalSmsSent = useCallback(
    async (rowId: string) => {
      const sentAt = new Date().toISOString();
      setRows((prevRows) =>
        prevRows.map((r) =>
          r.id === rowId ? { ...r, arrival_sms_sent_at: sentAt } : r,
        ),
      );
      const { error: ue } = await supabase
        .from("inventory_items")
        .update({ arrival_sms_sent_at: sentAt })
        .eq("id", rowId);
      // 컬럼 미존재 등으로 저장 실패해도 화면 표시는 유지(다음 새로고침 때만 사라짐).
      if (ue) {
        // 조용히 무시: 발송 자체는 성공했으므로 사용자 흐름을 막지 않는다.
      }
    },
    [supabase],
  );

  /** 미수가 있던 매출을 모달에서 '완불 처리 + 출고완료' 확정. 변경이력도 함께 남긴다. */
  const confirmShipWithReceivableClear = useCallback(async () => {
    const ctx = receivableShipConfirm;
    if (!ctx || receivableShipSaving) return;
    setReceivableShipSaving(true);
    setError(null);
    const updatedAt = new Date().toISOString();
    const beforeReceivable = ctx.receivableWon;
    const beforeShipped = Boolean(ctx.row.shipped);
    const beforeShippedNote = ctx.row.shipped_note ?? null;
    const payload = {
      updated_at: updatedAt,
      shipped_note: ctx.nextNote || null,
      shipped: true,
      receivable_won: null as number | null,
    };
    const { error: ue } = await supabase
      .from("inventory_items")
      .update(payload)
      .eq("id", ctx.row.id);
    if (ue) {
      setReceivableShipSaving(false);
      setError(ue.message);
      return;
    }
    setRows((prevRows) =>
      prevRows.map((r) =>
        r.id === ctx.row.id ? { ...r, ...payload, updated_at: updatedAt } : r,
      ),
    );

    /** 변경이력에 미수 완불 → 출고완료 흔적 남기기 (관리자만 insert 가능). */
    const before: Record<string, unknown> = {
      receivable_won: beforeReceivable,
      shipped: beforeShipped,
      shipped_note: beforeShippedNote,
    };
    const after: Record<string, unknown> = {
      receivable_won: null,
      shipped: true,
      shipped_note: ctx.nextNote || null,
    };
    const changes = buildChangeMap(before, after, [
      "receivable_won",
      "shipped",
      "shipped_note",
    ]);
    if (Object.keys(changes).length > 0 && profile?.id) {
      // 변경이력 기록은 실패해도 본 저장은 이미 완료되었으므로 silent 처리
      await supabase
        .from("inventory_audit_log")
        .insert({
          inventory_item_id: ctx.row.id,
          changed_by: profile.id,
          changes,
        });
    }

    setReceivableShipConfirm(null);
    setReceivableShipSaving(false);
    pushUndo({
      rowId: ctx.row.id,
      actionLabel: "미수 완불 + 출고 완료",
      before: snapInOutRow(ctx.row),
    });
    showBriefMsg(
      `미수 ${formatKRW(beforeReceivable)} 완불 처리 후 출고완료로 저장했습니다.`,
    );
  }, [
    profile?.id,
    receivableShipConfirm,
    receivableShipSaving,
    supabase,
    pushUndo,
    snapInOutRow,
    showBriefMsg,
  ]);

  /** 모달 닫기 — 출고 입력칸을 저장 전 값으로 되돌린다. */
  const cancelShipWithReceivableClear = useCallback(() => {
    if (receivableShipSaving) return;
    setReceivableShipConfirm(null);
    setShippedInputResetTick((v) => v + 1);
  }, [receivableShipSaving]);

  const saveJongroQuoteOverride = useCallback(
    async (rowId: string, digits: string) => {
      const trimmed = digits.trim();
      const next =
        trimmed.length === 0 ? null : (parseWonDigitsToNumber(trimmed) ?? null);
      const prev = rows.find((r) => r.id === rowId)?.jongro_quote_override_per_don ?? null;
      const prevRounded =
        prev != null && Number.isFinite(Number(prev)) ? Math.round(Number(prev)) : null;
      const nextRounded =
        next != null && Number.isFinite(Number(next)) ? Math.round(Number(next)) : null;
      if (prevRounded === nextRounded) {
        setJongroQuoteEdits((m) => {
          const { [rowId]: _drop, ...rest } = m;
          return rest;
        });
        return;
      }

      setError(null);
      const updatedAt = new Date().toISOString();
      const { error: ue } = await supabase
        .from("inventory_items")
        .update({
          jongro_quote_override_per_don: nextRounded,
          updated_at: updatedAt,
        })
        .eq("id", rowId);
      if (ue) {
        setError(ue.message);
        return;
      }
      setRows((prevRows) =>
        prevRows.map((r) =>
          r.id === rowId
            ? { ...r, jongro_quote_override_per_don: nextRounded, updated_at: updatedAt }
            : r,
        ),
      );
      setJongroQuoteEdits((m) => {
        const { [rowId]: _drop, ...rest } = m;
        return rest;
      });
    },
    [rows, supabase],
  );

  const loadProcessingQuote = useCallback(async () => {
    if (!effectiveBranchId) {
      setProcessingGoldPriceDigits("");
      setProcessingSavedGoldPerDon(null);
      setProcessingSavedAt(null);
      setProcessingQuoteLoading(false);
      return;
    }
    setProcessingQuoteLoading(true);
    const { data, error: qe } = await supabase
      .from("jongro_daily_quotes")
      .select("quote_scope, price_per_don, updated_at")
      .eq("branch_id", effectiveBranchId)
      .eq("quote_date", processingQuoteDate)
      .eq("quote_scope", JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER)
      .maybeSingle();
    setProcessingQuoteLoading(false);
    if (qe) {
      setError(qe.message + jongroDailyQuotesSetupHint(qe.message));
      return;
    }
    const row = data as {
      quote_scope: string | null;
      price_per_don: number;
      updated_at?: string;
    } | null;
    const goldPerDon =
      row?.price_per_don != null && Number.isFinite(Number(row.price_per_don))
        ? Math.round(Number(row.price_per_don))
        : null;
    setProcessingGoldPriceDigits(goldPerDon != null ? String(goldPerDon) : "");
    setProcessingSavedGoldPerDon(goldPerDon);
    setProcessingSavedAt(row?.updated_at ?? null);
  }, [supabase, effectiveBranchId, processingQuoteDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setUpdating(false);
    setError(null);
    setMsg(null);
    // NOTE: profile/branches are provided by AppLayout (server) for fast tab switches.
    const prof = bootstrap.profile;
    const list = bootstrap.branches;
    setProfile(prof);
    setBranches(list);
    const shopList = branchesForShopSelect(list);
    const adminDefaultId = firstShopSelectableBranchId(list);
    const adminChosen =
      (prof as Profile).role === "admin" &&
      branchId &&
      shopList.some((b) => b.id === branchId)
        ? branchId
        : adminDefaultId;
    const effectiveBranchId =
      (prof as Profile).role === "admin"
        ? adminChosen
        : (prof as Profile).branch_id || "";
    if ((prof as Profile).role === "admin") {
      setBranchId(adminChosen);
    } else if (!branchId) {
      setBranchId(effectiveBranchId);
    }

    if (!effectiveBranchId) {
      setRows([]);
      setQuoteRows([]);
      setLoading(false);
      return;
    }

    const fromIso = new Date(`${fromDate}T00:00:00`).toISOString();
    const toIso = new Date(`${toDate}T23:59:59.999`).toISOString();

    const searchActive = ledgerSearch.trim().length > 0;
    const cacheKey = `sales-ledger|${effectiveBranchId}|${fromDate}|${toDate}|unshipped:${ledgerUnshippedOnly ? "1" : "0"}|search:${searchActive ? "1" : "0"}`;
    if (rows.length > 0) setLoading(false);

    await swrLoad<{
      invRows: InventoryItem[];
      quoteRows: QuoteRow[];
    }>({
      key: cacheKey,
      ttlMs: 60_000,
      fetcher: async () => {
        const invQuery = supabase
          .from("inventory_items")
          .select("*")
          .eq("branch_id", effectiveBranchId);

        // "미출고"·검색은 조회 기간(from/to)과 무관하게 전체에서 찾는다.
        const bypassPeriod = ledgerUnshippedOnly || searchActive;
        const invRes = await (ledgerUnshippedOnly
          ? invQuery.eq("shipped", false).order("sold_at", { ascending: false })
          : bypassPeriod
            ? invQuery.order("sold_at", { ascending: false })
            : invQuery
                .gte("sold_at", fromIso)
                .lte("sold_at", toIso)
                .order("sold_at", { ascending: false }));
        if (invRes.error) throw new Error(invRes.error.message);
        const invRows = (invRes.data ?? []) as InventoryItem[];

        const quoteRange = (() => {
          if (!bypassPeriod) return { from: fromDate, to: toDate };
          let min: string | null = null;
          let max: string | null = null;
          for (const r of invRows) {
            const iso = r.sold_at ?? r.updated_at;
            const ymd = seoulYmdFromIso(iso);
            if (!min || ymd < min) min = ymd;
            if (!max || ymd > max) max = ymd;
          }
          return min && max ? { from: min, to: max } : { from: fromDate, to: toDate };
        })();

        const quoteRes = await supabase
          .from("jongro_daily_quotes")
          .select("quote_date, quote_scope, price_per_don")
          .eq("branch_id", effectiveBranchId)
          .gte("quote_date", quoteRange.from)
          .lte("quote_date", quoteRange.to)
          .in("quote_scope", [
            JONGRO_QUOTE_SCOPE_GOLD,
            JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER,
            JONGRO_QUOTE_SCOPE_SILVER,
          ]);
        if (quoteRes.error) {
          throw new Error(
            quoteRes.error.message + jongroDailyQuotesSetupHint(quoteRes.error.message),
          );
        }
        const quoteRows = (quoteRes.data ?? []) as QuoteRow[];

        return { invRows, quoteRows };
      },
      onHit: (cached) => {
        setRows(cached.invRows);
        setQuoteRows(cached.quoteRows);
        setLoading(false);
        setUpdating(true);
      },
      onFresh: ({ invRows, quoteRows }) => {
        setRows(invRows);
        setQuoteRows(quoteRows);
        setUpdating(false);
        setLoading(false);
      },
      onError: (e) => {
        setUpdating(false);
        setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
        setLoading(false);
      },
    });
  }, [supabase, branchId, fromDate, toDate, ledgerUnshippedOnly, ledgerSearch, bootstrap]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadProcessingQuote();
  }, [loadProcessingQuote]);

  useEffect(() => {
    if (view !== "month") return;
    const r = monthDateRange(selectedYear, selectedMonth);
    setFromDate(r.from);
    setToDate(r.to);
  }, [selectedYear, selectedMonth, view]);

  const yearSummary = useMemo(() => {
    if (view !== "yearTotal") return null;
    const byMonth = Array.from({ length: 13 }, () => ({ count: 0, marginSum: 0 }));
    let count = 0;
    let marginSum = 0;
    for (const r of rows) {
      const ymd = seoulYmdFromIso(r.sold_at ?? r.updated_at);
      if (!ymd.startsWith(`${selectedYear}-`)) continue;
      const mo = Number(ymd.slice(5, 7));
      if (!Number.isFinite(mo) || mo < 1 || mo > 12) continue;
      const m = salesLedgerTableDisplayedMarginWon(
        r,
        quoteByDateScopeEffective,
        jongroQuoteEdits,
        laborEdits,
      );
      if (m == null) continue;
      byMonth[mo].count += 1;
      byMonth[mo].marginSum += m;
      count += 1;
      marginSum += m;
    }
    return { total: { count, marginSum }, byMonth };
  }, [view, rows, selectedYear, quoteByDateScopeEffective, jongroQuoteEdits, laborEdits]);

  async function applyProcessingQuoteToDay() {
    if (!effectiveBranchId) {
      setError("지점을 먼저 선택하세요.");
      return;
    }
    const gold = parseWonDigitsToNumber(processingGoldPriceDigits);
    if (gold == null || !Number.isFinite(gold) || gold <= 0) {
      setError("금 처리시세(원/돈)를 숫자로 입력하세요.");
      return;
    }
    if (
      !confirm(
        `${processingQuoteDate} · 금 ${formatKRW(gold)}원/돈을 저장합니다. 저장 즉시 매출장부 원가/마진 계산에 반영됩니다.\n\n계속할까요?`,
      )
    ) {
      return;
    }

    setProcessingApplyBusy(true);
    setError(null);
    const { error: ue } = await supabase.from("jongro_daily_quotes").upsert(
      [
        {
          branch_id: effectiveBranchId,
          quote_date: processingQuoteDate,
          quote_scope: JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER,
          price_per_don: Math.round(gold),
        },
      ],
      { onConflict: "branch_id,quote_date,quote_scope" },
    );
    setProcessingApplyBusy(false);
    if (ue) {
      setError(ue.message + jongroDailyQuotesSetupHint(ue.message));
      return;
    }
    setMsg("금 매입시세 저장 완료. 매출장부 계산에 반영되었습니다.");
    await Promise.all([load(), loadProcessingQuote()]);
  }

  const totals = useMemo(() => {
    let sell = 0;
    let cost = 0;
    let margin = 0;
    let nCost = 0;
    let nMargin = 0;
    for (const r of rows) {
      const rowQuote = salesLedgerEffectiveQuotePerDonForRow(
        r,
        quoteByDateScopeEffective,
        jongroQuoteEdits,
      );
      const s = r.sell_price != null ? Number(r.sell_price) : NaN;
      if (Number.isFinite(s)) sell += Math.round(s);
      const c = inventorySaleMetalCostWon(
        r.kind === "silver" ? null : rowQuote,
        r.kind === "silver" ? rowQuote : null,
        r,
      );
      if (c != null) {
        cost += c;
        nCost += 1;
      }
      const m = salesLedgerTableDisplayedMarginWon(
        r,
        quoteByDateScopeEffective,
        jongroQuoteEdits,
        laborEdits,
      );
      if (m != null) {
        margin += m;
        nMargin += 1;
      }
    }
    return { sell, cost, margin, nCost, nMargin };
  }, [rows, quoteByDateScopeEffective, jongroQuoteEdits, laborEdits]);

  if (!isAdmin && profile) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        매출 장부는 관리자만 볼 수 있습니다.
      </div>
    );
  }

  return (
    <div className="sales-ledger-compact space-y-3">
      <header className="mb-0">
        <div className="min-w-0">
            <h1 className="purchase-ledger-header-title">매출장부</h1>
            <p className="purchase-ledger-header-desc">
              <span className="font-semibold text-[#191f28] dark:text-[var(--foreground)]">
                매출등록
              </span>
              에 저장된 매출을 기간·지점별로 모읍니다. 해당 일자·지점의{" "}
              <span className="font-semibold text-[#191f28] dark:text-[var(--foreground)]">
                처리시세
              </span>
              (종로 일별 시세)로 금속 원가를 잡고, 판매가 − 원가를 마진으로 표시합니다. 행에
              원가가 직접 입력되어 있으면 그 값을 원가로 씁니다.
            </p>
          </div>
      </header>

      {error ? (
        <div className="toss-alert-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      {msg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {msg}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch lg:gap-4">
        <section className="purchase-ledger-work-card flex h-full min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="purchase-ledger-section-label">년도</p>
            <button
              type="button"
              onClick={() => {
                const input = prompt("추가할 연도(예: 2028)");
                if (!input) return;
                const n = Number(String(input).trim());
                addYearFolder(n);
              }}
              className="tongsang-pill-ghost shrink-0 text-xs"
            >
              + 연도 추가
            </button>
          </div>
          <div className="tongsang-pill-row mt-2">
            {yearFolders.map((y) => {
              const active = selectedYear === y;
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setSelectedYear(y);
                    setView("month");
                  }}
                  className={
                    active
                      ? "tongsang-pill tongsang-pill-active"
                      : "tongsang-pill tongsang-pill-inactive"
                  }
                >
                  {formatLedgerYearLabel(y)}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="purchase-ledger-section-label">{formatLedgerYearLabel(selectedYear)}</p>
            <button
              type="button"
              onClick={() => {
                setView("yearTotal");
                setFromDate(`${selectedYear}-01-01`);
                setToDate(`${selectedYear}-12-31`);
              }}
              className={
                view === "yearTotal"
                  ? "tongsang-pill tongsang-pill-active text-xs"
                  : "tongsang-pill tongsang-pill-inactive text-xs"
              }
            >
              연합계
            </button>
          </div>
          <div className="purchase-ledger-month-row mt-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const active = view === "month" && selectedMonth === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setView("month");
                    setSelectedMonth(m);
                  }}
                  className={
                    active
                      ? "tongsang-pill tongsang-pill-active"
                      : "tongsang-pill tongsang-pill-inactive"
                  }
                >
                  {m}월
                </button>
              );
            })}
          </div>

          <DailyBranchProfitPanel
            branchId={effectiveBranchId}
            variant="purchase-ledger"
          />
        </section>

        <section className="purchase-ledger-work-card flex h-full min-w-0 flex-col">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <div className="min-w-[8rem] flex-1">
              <label className="purchase-ledger-field-label" htmlFor="sales-branch">
                지점
              </label>
              <select
                id="sales-branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                disabled={!isAdmin}
                className="purchase-ledger-field-input"
              >
                {branchesForShopSelect(branches).map((b) => (
                  <option key={b.id} value={b.id}>
                    {branchLabelForId(branches, b.id)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="purchase-ledger-field-label" htmlFor="sales-from">
                시작일
              </label>
              <input
                id="sales-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="purchase-ledger-field-input tabular-nums"
              />
            </div>
            <div>
              <label className="purchase-ledger-field-label" htmlFor="sales-to">
                종료일
              </label>
              <input
                id="sales-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="purchase-ledger-field-input tabular-nums"
              />
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="purchase-ledger-btn-primary"
            >
              조회
            </button>
          </div>

          <div className="purchase-ledger-block-gap">
            <p className="purchase-ledger-section-label">오늘의 매입시세</p>
            <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
              <div>
                <label className="purchase-ledger-field-label" htmlFor="sales-quote-date">
                  기준일
                </label>
                <input
                  id="sales-quote-date"
                  type="date"
                  value={processingQuoteDate}
                  onChange={(e) => setProcessingQuoteDate(e.target.value)}
                  className="purchase-ledger-field-input tabular-nums"
                />
              </div>
              <div>
                <label className="purchase-ledger-field-label" htmlFor="sales-gold-quote">
                  금 매입시세(원/돈)
                </label>
                <input
                  id="sales-gold-quote"
                  value={formatWonInputDisplay(processingGoldPriceDigits)}
                  onChange={(e) =>
                    setProcessingGoldPriceDigits(sanitizeWonInputDigits(e.target.value))
                  }
                  placeholder="예: 428000"
                  className="purchase-ledger-field-input w-44 tabular-nums"
                  inputMode="numeric"
                />
              </div>
              <button
                type="button"
                disabled={processingApplyBusy || processingQuoteLoading || !effectiveBranchId}
                onClick={() => void applyProcessingQuoteToDay()}
                className="purchase-ledger-btn-primary"
              >
                {processingApplyBusy ? "반영 중…" : "저장 후 장부 반영"}
              </button>
            </div>
            <div className="mt-2 min-h-[1.25rem] text-xs text-[#8b95a1]">
              {processingQuoteLoading ? (
                "불러오는 중…"
              ) : processingSavedAt && processingSavedGoldPerDon != null ? (
                (() => {
                  const inputN = parseWonDigitsToNumber(processingGoldPriceDigits);
                  const input =
                    inputN != null && Number.isFinite(inputN) ? Math.round(inputN) : null;
                  const same = input != null && input === processingSavedGoldPerDon;
                  return same ? (
                    <>
                      저장 {formatKRW(processingSavedGoldPerDon)}원/돈 ·{" "}
                      {formatDateTime(processingSavedAt)}
                    </>
                  ) : (
                    <>
                      저장값 {formatKRW(processingSavedGoldPerDon)}원/돈 ·{" "}
                      {formatDateTime(processingSavedAt)}
                      {input != null ? (
                        <>
                          {" "}
                          (현재 입력 {formatKRW(input)}원/돈 · 미저장)
                        </>
                      ) : (
                        " (현재 입력 미저장)"
                      )}
                    </>
                  );
                })()
              ) : effectiveBranchId ? (
                "이 날짜에 저장된 시세 없음"
              ) : null}
            </div>
          </div>

          <div className="purchase-ledger-stat-block">
            <div className="flex flex-wrap gap-6 sm:gap-8">
              <div className="min-w-[10rem]">
                <p className="purchase-ledger-stat-label">선택 기간 마진 합계</p>
                <p className="purchase-ledger-stat-value purchase-ledger-stat-value-accent">
                  {loading ? "…" : formatKRW(totals.margin)}
                </p>
              </div>
              <div className="min-w-[6rem]">
                <p className="purchase-ledger-stat-label">건수</p>
                <p className="purchase-ledger-stat-value">
                  {loading ? "…" : `${rows.length}건`}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {view === "yearTotal" && yearSummary ? (
        <section className="purchase-ledger-work-card">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">{formatLedgerYearLabel(selectedYear)} 연합계</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            선택 지점 기준으로, 월별 건수/마진 합계를 보여줍니다.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-3 py-3">
              <p className="text-xs font-medium text-[var(--muted)]">연 마진 합계</p>
              <p className="mt-1 text-xl font-semibold text-amber-900">
                {loading ? "…" : formatKRW(yearSummary.total.marginSum)}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-3 py-3">
              <p className="text-xs font-medium text-[var(--muted)]">연 건수</p>
              <p className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                {loading ? "…" : `${yearSummary.total.count}건`}
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[36rem] text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs font-medium text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2 text-center">월</th>
                  <th className="px-2 py-2 text-center">건수</th>
                  <th className="px-2 py-2 text-center">마진 합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <tr key={m}>
                    <td className="px-2 py-2 text-center">{m}월</td>
                    <td className="px-2 py-2 text-center">{yearSummary.byMonth[m].count}</td>
                    <td className="px-2 py-2 text-center tabular-nums monthly-purchase-ledger-margin">
                      {formatKRW(yearSummary.byMonth[m].marginSum)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="purchase-ledger-work-card flex min-h-[45vh] w-full flex-col overflow-hidden lg:min-h-[calc(100dvh-10.5rem)]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <h2 className="purchase-ledger-section-label">월 매출장부</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-[#8b95a1]">날짜</span>
              <button
                type="button"
                onClick={() => setLedgerDateSortAsc(true)}
                className={purchaseLedgerToolbarPill(ledgerDateSortAsc)}
              >
                오름차순
              </button>
              <button
                type="button"
                onClick={() => setLedgerDateSortAsc(false)}
                className={purchaseLedgerToolbarPill(!ledgerDateSortAsc)}
              >
                내림차순
              </button>
              <button
                type="button"
                onClick={() => setLedgerTodayOnly((v) => !v)}
                className={purchaseLedgerToolbarPill(ledgerTodayOnly)}
              >
                오늘만
              </button>
              <button
                type="button"
                onClick={() => setLedgerUnshippedOnly((v) => !v)}
                className={purchaseLedgerToolbarPill(ledgerUnshippedOnly)}
              >
                미출고
              </button>
              <button
                type="button"
                onClick={() => setLedgerCardCashReceiptOnly((v) => !v)}
                title="결제방식이 카드 또는 현영(현금영수증)인 행만 표시"
                className={purchaseLedgerToolbarPill(ledgerCardCashReceiptOnly)}
              >
                카드/현영
              </button>
              <div className="relative shrink-0">
                <input
                  type="search"
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  placeholder="고객명·전화·제품명 (전체 검색)"
                  aria-label="고객명·전화번호·제품명으로 월 매출장부 전체 검색"
                  title="입력하면 조회 기간을 무시하고 이 매장 매출 전체에서 찾습니다"
                  className="purchase-ledger-field-input !mt-0 h-8 w-[10.5rem] !px-2 !pr-7 !text-xs"
                />
                {ledgerSearch ? (
                  <button
                    type="button"
                    onClick={() => setLedgerSearch("")}
                    aria-label="검색어 지우기"
                    title="검색어 지우기"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-xs leading-none text-[#8b95a1] hover:text-[#191f28]"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              {canUndo ? (
                <button
                  type="button"
                  onClick={() => void undoLast()}
                  title="마지막 입고·출고 변경을 되돌립니다 (Ctrl+Z)"
                  className="tongsang-pill tongsang-pill-inactive px-3 py-1.5 text-xs"
                >
                  ↩ 되돌리기
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void autoFillLaborFees()}
                disabled={autoLaborBusy || autoFillableLaborRows.length === 0}
                title="제품명이 공임관리에 등록된 제품과 일치하는 행 중, 공임이 비어 있는 행에 공임을 자동으로 채워 저장합니다."
                className={
                  autoFillableLaborRows.length > 0 && !autoLaborBusy
                    ? "purchase-ledger-btn-primary !px-3 !py-1.5 !text-xs"
                    : "tongsang-pill tongsang-pill-inactive px-3 py-1.5 text-xs disabled:opacity-50"
                }
              >
                {autoLaborBusy
                  ? "공임 입력 중…"
                  : autoFillableLaborRows.length > 0
                    ? `공임 자동입력 (${autoFillableLaborRows.length}건)`
                    : "공임 자동입력"}
              </button>
            </div>
          </div>
          <p className="text-[11px] font-medium tabular-nums text-[#8b95a1]">
            {loading
              ? "…"
              : ledgerTodayOnly ||
                  ledgerUnshippedOnly ||
                  ledgerCardCashReceiptOnly ||
                  ledgerSearch.trim().length > 0
                ? `${ledgerDisplayRows.length}건 · 매출 ${formatKRW(ledgerTableSellSum)} · 이익 ${formatKRW(ledgerTableMarginSum)} (${[
                    ledgerTodayOnly ? "오늘" : "",
                    ledgerUnshippedOnly ? "미출고" : "",
                    ledgerCardCashReceiptOnly ? "카드·현영" : "",
                    ledgerSearch.trim().length > 0 ? "전체검색" : "",
                  ].filter(Boolean).join("·")})`
                : `${rows.length}건 · 매출 ${formatKRW(ledgerTableSellSum)} · 이익 ${formatKRW(ledgerTableMarginSum)}`}
          </p>
        </div>
        <div
          ref={sumRef}
          className="sales-ledger-table-scroll relative isolate min-h-0 flex-1 overflow-auto"
        >
          <LedgerSelectionSumBar
            rootRef={sumRef}
            clipboardCopy={salesLedgerClipboardCopy}
          />
          <table className="sales-ledger-table ledger-cell-select w-full min-w-[88rem] table-fixed cursor-cell select-none border-separate border-spacing-0 text-center text-xs tabular-nums tracking-tight [&_td]:px-0.5 [&_td]:py-1 [&_th]:px-0.5 [&_th]:py-1">
            <colgroup>
              <col className="w-[3.75rem]" /> {/* 미수 */}
              <col className="w-[3.75rem]" /> {/* 날짜 */}
              <col className="w-[4.5rem]" /> {/* 고객명 */}
              <col className="w-[6rem]" /> {/* 전화번호 */}
              <col className="w-[6.25rem]" /> {/* 제품명 */}
              <col className="w-[2.75rem]" /> {/* 수량 */}
              <col className="w-[3.75rem]" /> {/* 공임 */}
              <col className="w-[4rem]" /> {/* 중량 */}
              <col className="w-[3.5rem]" /> {/* 함량 */}
              <col className="w-[5rem]" /> {/* 판매가 */}
              <col className="w-[5rem]" /> {/* 원가 */}
              <col className="w-[5.25rem]" /> {/* 마진 */}
              <col className="w-[5rem]" /> {/* 종로 */}
              <col className="w-[5rem]" /> {/* 현 */}
              <col className="w-[7.75rem]" /> {/* 주문/입출고 */}
              <col className="w-[5rem]" /> {/* 업체명 */}
              <col className="w-[3.25rem]" /> {/* 발주 */}
              <col className="w-[3.25rem]" /> {/* 사이즈 */}
              <col className="w-[3.75rem]" /> {/* 결제방식 */}
              <col className="w-[3.25rem]" /> {/* 수정 */}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f2f4f6] text-[11px] font-semibold text-[#8b95a1] shadow-[0_1px_0_0_#e8ebef] dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)] dark:shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th className="whitespace-nowrap px-0.5 py-1">미수</th>
                <th className="whitespace-nowrap px-0.5 py-1">날짜</th>
                <th className="whitespace-nowrap px-0.5 py-1">고객명</th>
                <th className="whitespace-nowrap px-0.5 py-1">전화</th>
                <th className="whitespace-nowrap px-0.5 py-1">제품명</th>
                <th className="whitespace-nowrap px-0.5 py-1">수량</th>
                <th className="whitespace-nowrap px-0.5 py-1">공임</th>
                <th className="whitespace-nowrap px-0.5 py-1">중량</th>
                <th className="whitespace-nowrap px-0.5 py-1">함량</th>
                <th className="whitespace-nowrap px-0.5 py-1">판매가</th>
                <th className="whitespace-nowrap px-0.5 py-1">원가</th>
                <th className="whitespace-nowrap px-0.5 py-1">마진</th>
                <th className="whitespace-nowrap px-0.5 py-1">종로</th>
                <th className="whitespace-nowrap px-0.5 py-1">현</th>
                <th className="whitespace-nowrap px-0.5 py-1">주문/입출고</th>
                <th className="whitespace-nowrap px-0.5 py-1">업체</th>
                <th className="whitespace-nowrap px-0.5 py-1">발주</th>
                <th className="whitespace-nowrap px-0.5 py-1">사이즈</th>
                <th className="whitespace-nowrap px-0.5 py-1">결제</th>
                <th className="whitespace-nowrap px-0.5 py-1">수정</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-[var(--foreground)]">
              {loading ? (
                <tr>
                  <td colSpan={salesLedgerTableColSpan} className="px-3 py-10 text-center text-[var(--muted)]">
                    불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={salesLedgerTableColSpan} className="px-3 py-10 text-center text-[var(--muted)]">
                    해당 기간 매출이 없습니다.
                  </td>
                </tr>
              ) : ledgerDisplayRows.length === 0 ? (
                <tr>
                  <td colSpan={salesLedgerTableColSpan} className="px-3 py-10 text-center text-[var(--muted)]">
                    {ledgerSearch.trim().length > 0
                      ? "검색 결과가 없습니다."
                      : ledgerCardCashReceiptOnly
                        ? "카드·현영 결제 매출이 없습니다."
                        : ledgerUnshippedOnly
                          ? "미출고 매출이 없습니다."
                          : ledgerTodayOnly
                            ? `오늘(${todayYmdSeoul()}) 등록된 매출이 없습니다.`
                            : "표시할 매출이 없습니다."}
                  </td>
                </tr>
              ) : (
                ledgerDisplayRows.map((r, i) => {
                  const prev = i > 0 ? ledgerDisplayRows[i - 1] : null;
                  const sold = r.sold_at ?? r.updated_at;
                  const soldYmdSeoul = seoulYmdFromIso(sold);
                  const prevYmdSeoul =
                    prev != null ? seoulYmdFromIso(prev.sold_at ?? prev.updated_at) : null;
                  const showDate = prevYmdSeoul == null || soldYmdSeoul !== prevYmdSeoul;
                  const ymd = seoulYmdFromIso(sold);
                  const isCard = isCardLedgerPayment(r.payment_method);
                  const goldPBase = goldQuotePerDonForSalesLedger(
                    quoteByDateScopeEffective,
                    ymd,
                  );
                  const silverPBase =
                    quoteByDateScopeEffective.get(`${ymd}|${JONGRO_QUOTE_SCOPE_SILVER}`) ?? null;
                  const effectiveQuotePerDon = salesLedgerEffectiveQuotePerDonForRow(
                    r,
                    quoteByDateScopeEffective,
                    jongroQuoteEdits,
                  );
                  const goldQuoteFactor = salesLedgerGoldQuoteFactor(r.kind);
                  const jongroEditable =
                    (isCard && goldQuoteFactor != null) || r.kind === "silver";
                  const qtyDisp = String(r.quantity);
                  const weightNum = r.weight_g != null ? Number(r.weight_g) : NaN;
                  const weightSumAttr =
                    Number.isFinite(weightNum) ? String(weightNum) : null;
                  const sellNum = r.sell_price != null ? Number(r.sell_price) : NaN;
                  const sellRounded =
                    Number.isFinite(sellNum) ? Math.round(sellNum) : null;
                  const inDisp = ledgerReceivedDisplay(r);
                  const outDisp = ledgerShippedDisplay(r);
                  const orderDisp = ledgerOrderRefDisplay(r);
                  const inDone = inDisp.trim() === "완";
                  const outDone = outDisp.trim() === "완";
                  const orderDone = orderDisp.trim() === "완";
                  const isSilverBar = String(r.name ?? "").trim().includes("실버바");
                  const isPurchaseVendor = isPurchaseVendorName(r.vendor_name);
                  const laborHasExplicitEdit = Object.prototype.hasOwnProperty.call(
                    laborEdits,
                    r.id,
                  );
                  const laborInputDigits = laborHasExplicitEdit
                    ? String(laborEdits[r.id] ?? "")
                    : isPurchaseVendor
                      ? ""
                      : r.labor_fee != null && Number.isFinite(Number(r.labor_fee))
                        ? sanitizeWonInputDigits(
                            String(Math.round(Number(r.labor_fee))),
                          )
                        : "";
                  // 업체명이 '매입'인 행은 공임이 따로 없는 게 기본이라 칸에 '매입'을
                  // 표시해 매입 매출임을 한눈에 알게 한다. 그래도 직접 숫자를 입력하면
                  // 저장되어 그 값이 우선한다.
                  const showPurchaseVendorLaborLabel =
                    isPurchaseVendor && laborInputDigits.trim() === "";
                  // 제품명이 공임표에 있으면, 비어있는 칸에 추천 공임을 흐리게 미리보기로 보여준다.
                  const laborSuggestion = suggestedLaborForRow(r);
                  const showLaborSuggestion =
                    !showPurchaseVendorLaborLabel &&
                    laborInputDigits.trim() === "" &&
                    laborSuggestion != null;
                  const laborWon = (() => {
                    if (laborHasExplicitEdit) {
                      const digits = String(laborEdits[r.id] ?? "").trim();
                      if (!digits) return 0;
                      const n = parseWonDigitsToNumber(digits);
                      return n != null && Number.isFinite(n) ? Math.round(n) : 0;
                    }
                    if (isPurchaseVendor) return 0;
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
                  const receivableWon =
                    r.receivable_won != null && Number.isFinite(Number(r.receivable_won))
                      ? Math.round(Number(r.receivable_won))
                      : 0;
                  const hasReceivable = receivableWon > 0;
                  const nowMetalWon =
                    (() => {
                      if (effectiveQuotePerDon == null) return null;
                      const w =
                        r.weight_g != null && Number.isFinite(Number(r.weight_g))
                          ? Number(r.weight_g)
                          : null;
                      if (w == null) return null;
                      const factor = salesLedgerGoldQuoteFactor(r.kind);
                      if (factor == null) return null;
                      // =IF(함량="14K",중량/3.75*0.6435*종로시세,IF(함량="18K",중량/3.75*0.826*종로시세,IF(함량="24K",중량/3.75*종로시세,0)))
                      return Math.round((w / 3.75) * factor * effectiveQuotePerDon);
                    })();
                  // 원가 = (공임 + 현시세) * 수량 (공임이 '-'면 0으로 계산)
                  const qtyN =
                    Number.isFinite(Number(r.quantity)) ? Math.round(Number(r.quantity)) : null;
                  const unitSum = (laborWon ?? 0) + (nowMetalWon ?? 0);
                  const baseCost = isSilverBar
                    ? silverBarCost
                    : qtyN != null
                      ? Math.round(unitSum * qtyN)
                      : null;
                  // 원가(표시)는 보정 없이 그대로
                  const displayCost = baseCost;
                  const margin = salesLedgerTableDisplayedMarginWon(
                    r,
                    quoteByDateScopeEffective,
                    jongroQuoteEdits,
                    laborEdits,
                  );
                  return (
                    <tr
                      key={r.id}
                      data-ledger-row={r.id}
                      className={
                        hasReceivable
                          ? "sales-ledger-receivable-row"
                          : "hover:bg-gray-100/80 dark:hover:bg-gray-800/40"
                      }
                    >
                      <td
                        className="whitespace-nowrap px-1 py-1.5 text-center text-xs tabular-nums text-[var(--foreground)]"
                        {...(hasReceivable
                          ? { "data-sum-won": String(receivableWon) }
                          : {})}
                      >
                        {receivableLedgerDisplay(r)}
                      </td>
                      <td
                        className="whitespace-nowrap px-1 py-1.5 text-center text-xs text-[var(--foreground)]"
                        data-clipboard-text={showDate ? soldYmdSeoul : ""}
                      >
                        {showDate ? formatMonthlyLedgerMoDay(sold) : ""}
                      </td>
                      <td className="truncate px-1 py-1.5 text-xs text-[var(--foreground)]">
                        {r.customer_name?.trim() ? r.customer_name : "—"}
                      </td>
                      <td className="whitespace-nowrap px-1 py-1.5 text-xs text-[var(--foreground)]">
                        {phoneLedgerDisplay(r.customer_phone) || "—"}
                      </td>
                      <td className="truncate px-1 py-1.5 text-center text-xs text-[var(--foreground)]">
                        {r.product_name?.trim() ? r.product_name : "—"}
                      </td>
                      <td className="whitespace-nowrap px-1 py-1.5 text-xs tabular-nums text-[var(--foreground)]">
                        {qtyDisp}
                      </td>
                      <td
                        className="whitespace-nowrap px-1 py-1.5 text-xs tabular-nums text-[var(--foreground)]"
                        {...(showPurchaseVendorLaborLabel
                          ? { "data-clipboard-text": "매입" }
                          : {})}
                      >
                        <input
                          value={formatWonInputDisplay(laborInputDigits)}
                          onChange={(e) => {
                            markLaborManualOverride(r.id);
                            const next = sanitizeWonInputDigits(e.target.value);
                            setLaborEdits((m) => ({ ...m, [r.id]: next }));
                          }}
                          onBlur={(e) => {
                            void saveLaborFee(
                              r.id,
                              sanitizeWonInputDigits(e.target.value),
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }}
                          inputMode="numeric"
                          placeholder={
                            showPurchaseVendorLaborLabel
                              ? "매입"
                              : showLaborSuggestion
                                ? (laborSuggestion as number).toLocaleString("ko-KR")
                                : "—"
                          }
                          title={
                            showPurchaseVendorLaborLabel
                              ? "업체명이 '매입'인 매출입니다. 공임이 따로 있으면 숫자로 입력해 덮어쓸 수 있습니다."
                              : showLaborSuggestion
                                ? "공임관리에 등록된 같은 제품명의 공임입니다. '공임 자동입력' 버튼으로 채우거나 직접 입력하세요."
                                : undefined
                          }
                          className={`w-[3.5rem] rounded border px-1 py-1 text-xs tabular-nums outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-400/25 ${
                            showLaborSuggestion
                              ? "border-emerald-200 bg-[var(--card)] text-center text-[var(--foreground)] placeholder:text-emerald-600 placeholder:opacity-90"
                              : "border-[var(--border)] bg-[var(--card)] text-center text-[var(--foreground)] placeholder:text-[var(--foreground)]"
                          }`}
                        />
                      </td>
                      <td
                        className="whitespace-nowrap px-1 py-1.5 text-xs tabular-nums text-[var(--foreground)]"
                        {...(weightSumAttr != null
                          ? { "data-sum-g": weightSumAttr }
                          : {})}
                      >
                        {r.weight_g != null && Number.isFinite(Number(r.weight_g))
                          ? r.weight_g
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-1 py-1.5 text-xs text-[var(--foreground)]">
                        {kindLabel(r.kind)}
                      </td>
                      <td
                        className="whitespace-nowrap px-1 py-1.5 text-xs font-medium tabular-nums text-[var(--foreground)]"
                        {...(sellRounded != null
                          ? { "data-sum-won": String(sellRounded) }
                          : {})}
                      >
                        {sellRounded != null ? formatKRW(sellRounded) : "—"}
                      </td>
                      <td
                        className="w-16 min-w-0 px-0.5 py-2 text-center text-xs tabular-nums text-[var(--foreground)]"
                        {...(displayCost != null
                          ? { "data-sum-won": String(displayCost) }
                          : {})}
                      >
                        {displayCost != null ? formatKRW(displayCost) : "—"}
                      </td>
                      <td
                        className={`monthly-purchase-ledger-margin tabular-nums whitespace-nowrap px-0.5 py-1 text-center ${
                          margin != null && margin < 0
                            ? "monthly-purchase-ledger-margin-negative"
                            : ""
                        }`}
                        {...(margin != null ? { "data-sum-won": String(margin) } : {})}
                      >
                        {margin != null ? formatKRW(margin) : "—"}
                      </td>
                      <td
                        className="w-16 min-w-0 px-0.5 py-2 text-center text-xs tabular-nums text-[var(--foreground)]"
                        {...(!jongroEditable &&
                        goldPBase != null &&
                        Number.isFinite(goldPBase)
                          ? {
                              "data-ledger-copy-won": String(Math.round(goldPBase)),
                            }
                          : {})}
                      >
                        {jongroEditable ? (
                          <input
                            value={formatWonInputDisplay(
                              salesLedgerJongroInputDigitsDefault(
                                r,
                                quoteByDateScopeEffective,
                                jongroQuoteEdits,
                              ),
                            )}
                            onChange={(e) => {
                              const next = sanitizeWonInputDigits(e.target.value);
                              setJongroQuoteEdits((m) => ({ ...m, [r.id]: next }));
                            }}
                            onBlur={(e) => {
                              const digits =
                                jongroQuoteEdits[r.id] ??
                                sanitizeWonInputDigits(e.target.value);
                              const baseRounded =
                                r.kind === "silver"
                                  ? silverPBase != null &&
                                    Number.isFinite(Number(silverPBase))
                                    ? Math.round(Number(silverPBase))
                                    : null
                                  : goldPBase != null && Number.isFinite(goldPBase)
                                    ? Math.round(goldPBase)
                                    : null;
                              const parsed =
                                digits.trim().length === 0
                                  ? null
                                  : (parseWonDigitsToNumber(digits) ?? null);
                              const parsedRounded =
                                parsed != null && Number.isFinite(parsed)
                                  ? Math.round(parsed)
                                  : null;
                              const sameAsDaily =
                                baseRounded != null &&
                                parsedRounded != null &&
                                parsedRounded === baseRounded;
                              void saveJongroQuoteOverride(
                                r.id,
                                sameAsDaily || parsedRounded == null ? "" : digits,
                              );
                            }}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              (e.currentTarget as HTMLInputElement).blur();
                            }}
                            inputMode="numeric"
                            placeholder="—"
                            title="카드(금): 당일 시세 기본 · 필요 시 종로 시세 직접 입력. 은: 행별 시세."
                            className="w-[4.25rem] rounded border border-[var(--border)] bg-[var(--card)] px-1 py-1 text-right text-xs tabular-nums text-[var(--foreground)] outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-400/25"
                          />
                        ) : goldPBase != null && Number.isFinite(goldPBase) ? (
                          formatKRW(Math.round(goldPBase))
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className="w-16 min-w-0 px-0.5 py-2 text-center text-xs tabular-nums text-[var(--foreground)]"
                        {...(nowMetalWon != null ? { "data-sum-won": String(nowMetalWon) } : {})}
                      >
                        {nowMetalWon != null ? formatKRW(nowMetalWon) : "—"}
                      </td>
                      <td
                        className="min-w-0 px-0.5 py-1 text-center text-xs text-[var(--foreground)]"
                        data-clipboard-text={`${orderDisp || "–"}/${inDisp || "–"}/${outDisp || "–"}`}
                      >
                        <div className="flex items-center justify-center gap-0.5">
                          <input
                            key={`${r.id}-ledger-order-ref-${shippedInputResetTick}`}
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
                            className={`w-[1.85rem] shrink-0 rounded border px-0.5 py-0.5 text-center text-[10px] font-semibold leading-none outline-none focus:ring-1 ${
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
                                className={`inline-flex w-[2.15rem] min-w-[2.15rem] shrink-0 items-center justify-center rounded border px-0.5 py-0.5 text-[10px] leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
                            key={`${r.id}-ledger-shipped-note-${shippedInputResetTick}`}
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
                            className={`w-[1.85rem] shrink-0 rounded border px-0.5 py-0.5 text-center text-[10px] font-semibold leading-none outline-none focus:ring-1 ${
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
                      <td className="max-w-[6rem] truncate px-1 py-2 text-xs text-[var(--foreground)]">
                        {r.vendor_name?.trim() ? r.vendor_name : "—"}
                      </td>
                      <td className="max-w-[7rem] truncate px-1 py-2 text-xs font-medium text-[var(--foreground)]">
                        {fulfillmentLabel(r.fulfillment_status)}
                      </td>
                      <td className="w-12 max-w-[3.5rem] truncate px-0.5 py-2 text-center text-xs text-[var(--foreground)]">
                        {r.size?.trim() ? r.size : "—"}
                      </td>
                      <td className="px-1 py-2 text-xs text-[var(--foreground)]">
                        {r.payment_method?.trim() ? r.payment_method : "—"}
                      </td>
                      <td className="px-1 py-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setEditingItem(r)}
                          className="monthly-purchase-ledger-margin text-xs hover:underline"
                        >
                          수정
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {!loading && ledgerDisplayRows.length > 0 ? (
              <tfoot className="sticky bottom-0 z-[5] border-t-2 border-[#e8ebef] bg-[#f9fafb]/95 text-sm font-semibold text-[#191f28] shadow-[0_-1px_0_0_#e8ebef] dark:border-[var(--border)] dark:bg-[var(--surface-subtle)]/95 dark:text-[var(--foreground)]">
                <tr>
                  <td
                    colSpan={salesLedgerTableColSpan - 2}
                    className="px-2 py-2.5 text-right text-xs font-semibold text-[#191f28] dark:text-[var(--foreground)]"
                  >
                    당일 금 매입시세(원/돈)
                    {updating ? (
                      <span className="ml-2 font-medium text-[#8b95a1]">
                        (업데이트 중…)
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-center text-xs font-semibold tabular-nums text-[#3182f6]">
                    {processingGoldPriceDigits.trim()
                      ? formatKRW(
                          parseWonDigitsToNumber(processingGoldPriceDigits) ?? 0,
                        )
                      : "—"}
                  </td>
                  <td className="px-2 py-2.5" />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <InventoryEditDialog
        supabase={supabase}
        item={editingItem}
        open={editingItem != null}
        onClose={() => setEditingItem(null)}
        onSaved={() => void load()}
        userId={profile?.id ?? ""}
        branches={branches}
        profile={profile}
        branchRows={branchSelectRowsForShop(branches)}
        quoteGoldPerDonDigits={processingGoldPriceDigits}
        quoteSilverPerDonDigits=""
      />

      {receivableShipConfirm ? (
        <ReceivableShipConfirmModal
          row={receivableShipConfirm.row}
          receivableWon={receivableShipConfirm.receivableWon}
          saving={receivableShipSaving}
          onConfirm={() => void confirmShipWithReceivableClear()}
          onCancel={cancelShipWithReceivableClear}
        />
      ) : null}
    </div>
  );
}

/** 미수가 있는 매출을 출고완료로 처리할 때 띄우는 안전 확인 모달. */
function ReceivableShipConfirmModal({
  row,
  receivableWon,
  saving,
  onConfirm,
  onCancel,
}: {
  row: InventoryItem;
  receivableWon: number;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Enter로 무심코 확정되지 않도록 기본 포커스는 '취소'에 둔다.
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!saving) onCancel();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  const soldYmd = row.sold_at
    ? localYmdFromIso(row.sold_at) ?? row.sold_at.slice(0, 10)
    : "—";
  const sellWon =
    row.sell_price != null && Number.isFinite(Number(row.sell_price))
      ? Math.round(Number(row.sell_price))
      : null;
  const customer =
    row.customer_name?.trim() ? row.customer_name.trim() : "(미입력)";
  const phone =
    row.customer_phone?.trim() ? row.customer_phone.trim() : "—";
  const itemLabel =
    [row.name?.trim(), row.product_name?.trim()].filter(Boolean).join(" / ") ||
    "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receivable-ship-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-300 bg-[var(--card)] shadow-2xl">
        <div className="border-b-4 border-rose-500 bg-rose-50 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
            미수금 확인 필요
          </p>
          <h3
            id="receivable-ship-title"
            className="mt-0.5 text-base font-semibold text-rose-900"
          >
            이 매출은 미수가 남아 있습니다
          </h3>
        </div>

        <div className="px-5 py-4">
          <div className="rounded-xl bg-rose-50 px-4 py-4 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700">
              남은 미수금
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-rose-700">
              {formatKRW(receivableWon)}
            </p>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
            <dt className="text-[var(--muted)]">날짜</dt>
            <dd className="col-span-2 font-medium tabular-nums text-[var(--foreground)]">
              {soldYmd}
            </dd>
            <dt className="text-[var(--muted)]">고객</dt>
            <dd className="col-span-2 truncate font-medium text-[var(--foreground)]">
              {customer}
              {phone !== "—" ? (
                <span className="ml-1 font-normal text-[var(--muted)]">({phone})</span>
              ) : null}
            </dd>
            <dt className="text-[var(--muted)]">품목</dt>
            <dd className="col-span-2 truncate font-medium text-[var(--foreground)]">
              {itemLabel}
            </dd>
            <dt className="text-[var(--muted)]">판매가</dt>
            <dd className="col-span-2 font-medium tabular-nums text-[var(--foreground)]">
              {sellWon != null ? formatKRW(sellWon) : "—"}
            </dd>
          </dl>

          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2.5 text-[12px] leading-snug text-rose-900">
            <strong className="font-semibold">확인</strong>을 누르면 미수금을
            <span className="mx-0.5 font-semibold">완불(0원)</span>로 변경하고
            출고를 <span className="mx-0.5 font-semibold">완</span>으로
            저장합니다. 변경 이력은 수정 창의
            <span className="mx-0.5 font-semibold">변경 이력</span>에 자동
            기록됩니다.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-stone-100 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
          >
            {saving
              ? "저장 중…"
              : `미수 ${formatKRW(receivableWon)} 완불 + 출고완료`}
          </button>
        </div>
      </div>
    </div>
  );
}

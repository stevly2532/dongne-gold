"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatDateTime,
  formatKRW,
  formatMonthlyLedgerMoDay,
  formatWonInputDisplay,
  localYmdFromIso,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
  seoulYmdFromIso,
  seoulYmdToUtcRangeIso,
  todayYmdSeoul,
  formatLedgerYearLabel,
} from "@/lib/format";
import {
  branchesForShopSelect,
  firstShopSelectableBranchId,
} from "@/lib/branchLabels";
import {
  effectiveWeightGForGoldPurchase,
  LEDGER_24K1_RECALC_DISPLAY_FROM_SEOUL_YMD,
  ledgerDisplayDonFromWeightG,
  PROCESSING_QUOTE_OFFSET_PER_DON_24K1,
} from "@/lib/goldPurchase";
import {
  jongroDailyQuotesSetupHint,
  processingLedgerFieldsForPurchase,
  yijeLedgerFieldsForPurchase,
} from "@/lib/purchaseMargin";
import {
  matchesLedgerCustomerSearch,
  purchaseLedgerSearchExtraTerms,
} from "@/lib/ledgerCustomerSearch";
import { normalizeKoreanMobilePhone } from "@/lib/koreanPhone";
import { LedgerSelectionSumBar } from "@/components/LedgerSelectionSumBar";
import { PurchaseLedgersChrome } from "@/components/PurchaseLedgersChrome";
import { DailyBranchProfitPanel } from "@/components/DailyBranchProfitPanel";
import { PurchaseEditDialog } from "@/components/PurchaseEditDialog";
import { useAppBootstrap } from "@/components/AppProviders";
import { swrLoad } from "@/lib/queryCache";
import {
  JONGRO_QUOTE_SCOPE_GOLD,
  type Branch,
  type ProcessingDailyQuote,
  type Profile,
  type Purchase,
} from "@/types/db";

/** `YYYY-MM-DD` 캘린더 날짜에 일수 더함 (브라우저 로컬 타임존). */
function addDaysToYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map((v) => parseInt(v, 10));
  const dt = new Date(y, m - 1, d + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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

type RowDraft = {
  purchasedAt: string;
  sellerName: string;
  sellerPhone: string;
  weightG: string;
  karat: string;
  totalAmount: string;
  note: string;
};

function monthDateRange(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const end = new Date(year, month, 0);
  const to = `${year}-${pad(month)}-${pad(end.getDate())}`;
  return { from, to };
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatKoreanLongDateFromYmd(ymd: string): string {
  const [y, mo, da] = ymd.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) {
    return ymd;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(y, mo - 1, da));
}

function normalizeKarat(s: unknown): string | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  if (raw === "외국금") return "외국금";
  let t = raw
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[‐‑–—−]/g, "-"); // normalize dashes
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
  return raw;
}

/** Ctrl/⌘+C 복사 시 첫 줄 헤더(표 열 순서와 동일, 삭제 열 제외) */
const MONTHLY_LEDGER_CLIPBOARD_HEADERS = [
  "날짜",
  "고객명",
  "전화번호",
  "중량(g)",
  "순금",
  "함량",
  "매입금액",
  "처리원가",
  "마진",
  "매입시세",
  "결제",
  "특이사항",
] as const;

function purchaseLedgerToolbarPill(active: boolean) {
  return active
    ? "tongsang-pill tongsang-pill-active px-3 py-1.5 text-xs"
    : "tongsang-pill tongsang-pill-inactive px-3 py-1.5 text-xs";
}

export default function MonthlyLedgerPage() {
  const monthlyLedgerSumRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const bootstrap = useAppBootstrap();
  const loadSeqRef = useRef(0);
  const initial = monthRange();
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const LS_YEARS = "goldLedger_yearFolders";

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
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [view, setView] = useState<"month" | "yearTotal">("month");
  const [rows, setRows] = useState<Purchase[]>([]);
  /** 월매입 장부 표: 날짜 열 기준 정렬 (기본 내림차순 = 최신→과거) */
  const [ledgerDateSortAsc, setLedgerDateSortAsc] = useState(false);
  /** 월매입 장부 표: 오늘(로컬 달력) 매입만 표시 */
  const [ledgerTodayOnly, setLedgerTodayOnly] = useState(false);
  /** 월매입 장부 표: 고객명·전화번호·제품명(함량·특이사항) 검색 */
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [lastLoadInfo, setLastLoadInfo] = useState<{
    seq: number;
    view: "month" | "yearTotal";
    branchId: string;
    rangeFrom: string;
    rangeTo: string;
    fromIso: string;
    toIso: string;
    rowCount: number;
    minYmdSeoul: string | null;
    maxYmdSeoul: string | null;
  } | null>(null);

  const [processingQuoteDate, setProcessingQuoteDate] = useState(() =>
    todayYmdSeoul(),
  );
  const [processingPriceDigits, setProcessingPriceDigits] = useState("");
  const [processingSaved, setProcessingSaved] = useState<ProcessingDailyQuote | null>(
    null,
  );
  const [processingQuoteLoading, setProcessingQuoteLoading] = useState(false);
  const [processingApplyBusy, setProcessingApplyBusy] = useState(false);
  /** 결제=의제 행: 월매입 장부 매입시세 수기 입력(관리자) */
  const [yijeQuoteEdits, setYijeQuoteEdits] = useState<Record<string, string>>(
    {},
  );
  const [yijeQuoteSavingId, setYijeQuoteSavingId] = useState<string | null>(
    null,
  );
  const [profitPanelReloadToken, setProfitPanelReloadToken] = useState(0);
  const isAdmin = profile?.role === "admin";

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
    setView("month");
  }

  const load = useCallback(async () => {
    const seq = (loadSeqRef.current += 1);
    setLoading(true);
    setUpdating(false);
    setError(null);
    setMsg(null);
    // NOTE: profile/branches are provided by AppLayout (server) for fast tab switches.
    const prof = bootstrap.profile;
    const list = bootstrap.branches;
    if (loadSeqRef.current !== seq) return;
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
    if (!effectiveBranchId) {
      if (loadSeqRef.current === seq) {
        setRows([]);
        setLoading(false);
      }
      return;
    }
    if ((prof as Profile).role === "admin") {
      setBranchId(adminChosen);
    } else if (!branchId) {
      setBranchId(effectiveBranchId);
    }

    const searchActive = ledgerSearch.trim().length > 0;
    const range =
      view === "yearTotal"
        ? { from: `${selectedYear}-01-01`, to: `${selectedYear}-12-31` }
        : { from: fromDate, to: toDate };
    const fromIso = seoulYmdToUtcRangeIso(range.from).from;
    const toIso = seoulYmdToUtcRangeIso(range.to).to;

    const cacheKey = searchActive
      ? `monthly-ledger|${effectiveBranchId}|search`
      : `monthly-ledger|${effectiveBranchId}|${view}|${range.from}|${range.to}`;
    // If we already have table rows, keep them while revalidating to avoid a blank reload.
    if (rows.length > 0) setLoading(false);

    await swrLoad<Purchase[]>({
      key: cacheKey,
      ttlMs: 60_000,
      fetcher: async () => {
        // NOTE: PostgREST has a default row limit (commonly 1000). 연합계는 연도 전체를 보므로
        // 1000건을 넘는 순간 4월 이후 데이터가 "없는 것처럼" 보일 수 있다. 따라서 페이지네이션으로 모두 가져온다.
        const pageSize = 1000;
        const all: Purchase[] = [];
        for (let offset = 0; ; offset += pageSize) {
          let q = supabase
            .from("purchases")
            .select("*, branches(name)")
            .eq("branch_id", effectiveBranchId)
            .eq("item_type", "금");
          if (!searchActive) {
            q = q.gte("purchased_at", fromIso).lte("purchased_at", toIso);
          }
          q = q
            .order("purchased_at", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + pageSize - 1);
          const { data: pu, error: pue } = await q;
          if (pue) throw new Error(pue.message);
          const page = (pu ?? []) as Purchase[];
          all.push(...page);
          if (page.length < pageSize) break;
        }
        return all;
      },
      onHit: (cachedRows) => {
        if (loadSeqRef.current !== seq) return;
        setRows(cachedRows);
        // keep table visible; refresh in background
        setLoading(false);
        setUpdating(true);
      },
      onFresh: (nextRows) => {
        if (loadSeqRef.current !== seq) return;
        setRows(nextRows);
        const minMax = nextRows.reduce(
          (acc, p) => {
            const ymd = seoulYmdFromIso(p.purchased_at);
            if (!acc.min || ymd < acc.min) acc.min = ymd;
            if (!acc.max || ymd > acc.max) acc.max = ymd;
            return acc;
          },
          { min: null as string | null, max: null as string | null },
        );
        setLastLoadInfo({
          seq,
          view,
          branchId: effectiveBranchId,
          rangeFrom: range.from,
          rangeTo: range.to,
          fromIso,
          toIso,
          rowCount: nextRows.length,
          minYmdSeoul: minMax.min,
          maxYmdSeoul: minMax.max,
        });
        setUpdating(false);
        setLoading(false);
      },
      onError: (e) => {
        if (loadSeqRef.current !== seq) return;
        setUpdating(false);
        setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
        setLoading(false);
      },
    });
  }, [
    supabase,
    branchId,
    fromDate,
    toDate,
    view,
    selectedYear,
    bootstrap,
    rows.length,
    ledgerSearch,
  ]);

  const loadProcessingQuote = useCallback(async () => {
    if (!branchId) {
      setProcessingSaved(null);
      setProcessingQuoteLoading(false);
      return;
    }
    setProcessingQuoteLoading(true);
    const { data, error: qe } = await supabase
      .from("jongro_daily_quotes")
      .select("*")
      .eq("branch_id", branchId)
      .eq("quote_date", processingQuoteDate)
      .eq("quote_scope", JONGRO_QUOTE_SCOPE_GOLD)
      .maybeSingle();
    setProcessingQuoteLoading(false);
    if (qe) {
      setProcessingSaved(null);
      setError(qe.message + jongroDailyQuotesSetupHint(qe.message));
      return;
    }
    const row = data as ProcessingDailyQuote | null;
    setProcessingSaved(row);
    if (row != null) {
      setProcessingPriceDigits(
        sanitizeWonInputDigits(String(Math.round(Number(row.price_per_don)))),
      );
    } else {
      setProcessingPriceDigits("");
    }
  }, [supabase, branchId, processingQuoteDate]);

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
    // load() depends on from/to, so it will refresh automatically
  }, [selectedMonth, selectedYear, view]);

  const yearSummary = useMemo(() => {
    if (view !== "yearTotal") return null;
    const map: Record<number, { count: number; marginSum: number }> = {};
    for (let m = 1; m <= 12; m++) map[m] = { count: 0, marginSum: 0 };
    for (const p of rows) {
      const ymd = seoulYmdFromIso(p.purchased_at);
      const y = Number(ymd.slice(0, 4));
      if (y !== selectedYear) continue;
      const m = Number(ymd.slice(5, 7));
      const mar = p.margin_amount != null ? Math.round(Number(p.margin_amount)) : 0;
      map[m].count += 1;
      map[m].marginSum += mar;
    }
    const total = Object.values(map).reduce(
      (a, v) => ({ count: a.count + v.count, marginSum: a.marginSum + v.marginSum }),
      { count: 0, marginSum: 0 },
    );
    return { byMonth: map, total };
  }, [rows, selectedYear, view]);

  function parseNumberLike(s: string) {
    const v = parseFloat(s.trim().replace(/,/g, ""));
    return Number.isFinite(v) ? v : null;
  }

  function roundWon(v: number | null) {
    if (v == null) return null;
    return Number.isFinite(v) ? Math.round(v) : null;
  }

  async function applyProcessingQuoteToDay() {
    if (!branchId) {
      setError("지점을 먼저 선택하세요.");
      return;
    }
    const price = parseWonDigitsToNumber(processingPriceDigits);
    if (price == null || price < 0) {
      setError("처리시세(원/돈)를 숫자로 입력하세요.");
      return;
    }
    if (
      !confirm(
        `${formatKoreanLongDateFromYmd(processingQuoteDate)} · ${formatKRW(price)}원/돈을 저장하고, 해당일 금 매입 건의 처리시세·처리원가·마진(처리원가 − 매입금액)을 이 기준으로 다시 계산합니다. 계속할까요?`,
      )
    ) {
      return;
    }
    setProcessingApplyBusy(true);
    setError(null);
    setMsg(null);

    const { error: ue } = await supabase.from("jongro_daily_quotes").upsert(
      {
        branch_id: branchId,
        quote_date: processingQuoteDate,
        quote_scope: JONGRO_QUOTE_SCOPE_GOLD,
        price_per_don: price,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "branch_id,quote_date,quote_scope" },
    );
    if (ue) {
      setError(ue.message + jongroDailyQuotesSetupHint(ue.message));
      setProcessingApplyBusy(false);
      return;
    }

    const dayBefore = addDaysToYmd(processingQuoteDate, -1);
    const dayAfter = addDaysToYmd(processingQuoteDate, 1);
    const fromIso = new Date(`${dayBefore}T00:00:00`).toISOString();
    const toIso = new Date(`${dayAfter}T23:59:59.999`).toISOString();

    const { data: purchases, error: pe } = await supabase
      .from("purchases")
      .select(
        "id, item_type, total_amount, weight_g, karat, purity, pure_gold_don, purchased_at, branch_id, payment_method",
      )
      .eq("branch_id", branchId)
      .gte("purchased_at", fromIso)
      .lte("purchased_at", toIso)
      .eq("item_type", "금");

    if (pe) {
      setError(pe.message);
      setProcessingApplyBusy(false);
      return;
    }

    const list = ((purchases ?? []) as Purchase[]).filter(
      (p) => localYmdFromIso(p.purchased_at) === processingQuoteDate,
    );
    const patches: { id: string; patch: Record<string, unknown> }[] = [];
    let skipped = 0;
    for (const p of list) {
      if (p.payment_method === "의제") {
        skipped += 1;
        continue;
      }
      const f = processingLedgerFieldsForPurchase(price, p);
      if (!f) {
        skipped += 1;
        continue;
      }
      patches.push({ id: p.id, patch: f });
    }

    const chunkSize = 25;
    for (let i = 0; i < patches.length; i += chunkSize) {
      const chunk = patches.slice(i, i + chunkSize);
      const results = await Promise.all(
        chunk.map(({ id, patch }) =>
          supabase.from("purchases").update(patch).eq("id", id),
        ),
      );
      for (const r of results) {
        if (r.error) {
          setError(r.error.message);
          setProcessingApplyBusy(false);
          await load();
          await loadProcessingQuote();
          return;
        }
      }
    }

    setProcessingApplyBusy(false);
    setMsg(
      `처리시세 저장 및 반영 완료: ${patches.length}건 업데이트` +
        (skipped > 0 ? ` · 중량·함량·순금 부족 등 ${skipped}건 건너뜀` : "") +
        ".",
    );
    await load();
    await loadProcessingQuote();
    setProfitPanelReloadToken((t) => t + 1);
  }

  const marginSum = useMemo(() => {
    return rows.reduce((a, p) => {
      const m = p.margin_amount;
      if (m == null || !Number.isFinite(Number(m))) return a;
      return a + Math.round(Number(m));
    }, 0);
  }, [rows]);

  const ledgerAmountSum = useMemo(() => {
    return rows.reduce((a, p) => a + Number(p.total_amount), 0);
  }, [rows]);

  const ledgerRowsSorted = useMemo(() => {
    const todayYmd = localYmd(new Date());
    let base =
      ledgerTodayOnly
        ? rows.filter((p) => localYmdFromIso(p.purchased_at) === todayYmd)
        : rows;
    const q = ledgerSearch.trim();
    if (q.length > 0) {
      base = base.filter((p) =>
        matchesLedgerCustomerSearch(
          q,
          p.seller_name,
          p.seller_phone,
          undefined,
          purchaseLedgerSearchExtraTerms(p),
        ),
      );
    }
    const copy = [...base];
    copy.sort((a, b) => {
      const ta = new Date(a.purchased_at).getTime();
      const tb = new Date(b.purchased_at).getTime();
      if (ta !== tb) return ledgerDateSortAsc ? ta - tb : tb - ta;
      return String(a.id).localeCompare(String(b.id));
    });
    return copy;
  }, [rows, ledgerDateSortAsc, ledgerTodayOnly, ledgerSearch]);

  // 오름차순(최근이 맨 아래)일 때, 로드 완료 후 맨 아래로 스크롤해 최근 입력이 보이게 한다.
  const didAutoScrollRef = useRef(false);
  useEffect(() => {
    if (loading) {
      didAutoScrollRef.current = false;
      return;
    }
    if (!ledgerDateSortAsc) return;
    if (didAutoScrollRef.current) return;
    const el = monthlyLedgerSumRef.current;
    if (!el) return;
    didAutoScrollRef.current = true;
    window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [loading, ledgerDateSortAsc, ledgerRowsSorted.length]);

  const ledgerTableAmountSum = useMemo(() => {
    return ledgerRowsSorted.reduce((a, p) => a + Number(p.total_amount), 0);
  }, [ledgerRowsSorted]);

  const ledgerTableMarginSum = useMemo(() => {
    return ledgerRowsSorted.reduce((a, p) => {
      const m = p.margin_amount;
      if (m == null || !Number.isFinite(Number(m))) return a;
      return a + Math.round(Number(m));
    }, 0);
  }, [ledgerRowsSorted]);

  const negativeMarginCount = useMemo(() => {
    return ledgerRowsSorted.reduce((a, p) => {
      const storedMarginWon =
        p.margin_amount != null && Number.isFinite(Number(p.margin_amount))
          ? Number(p.margin_amount)
          : null;
      const storedProcessingWon =
        p.processing_price_per_don != null &&
        Number.isFinite(Number(p.processing_price_per_don))
          ? Number(p.processing_price_per_don)
          : null;
      const displayMarginWon =
        p.payment_method === "의제"
          ? storedMarginWon
          : storedProcessingWon != null &&
              Number.isFinite(Number(p.total_amount))
            ? Math.round(storedProcessingWon - Number(p.total_amount))
            : storedMarginWon;
      return a + (displayMarginWon != null && Number.isFinite(displayMarginWon) && displayMarginWon < 0 ? 1 : 0);
    }, 0);
  }, [ledgerRowsSorted]);

  async function handleDeletePurchase(id: string) {
    if (!confirm("이 매입 기록을 삭제할까요?")) return;
    const { error: de } = await supabase.from("purchases").delete().eq("id", id);
    if (de) {
      setError(de.message);
      return;
    }
    await load();
  }

  function yijeQuoteDigitsForRow(p: Purchase): string {
    if (yijeQuoteEdits[p.id] !== undefined) return yijeQuoteEdits[p.id];
    if (
      p.gold_price_per_don != null &&
      Number.isFinite(Number(p.gold_price_per_don))
    ) {
      return sanitizeWonInputDigits(String(Math.round(Number(p.gold_price_per_don))));
    }
    return "";
  }

  async function saveYijePurchaseQuote(p: Purchase) {
    const digits = yijeQuoteDigitsForRow(p);
    const n = parseWonDigitsToNumber(digits);
    if (n == null || !Number.isFinite(n) || n < 0) {
      setError("의제 매입시세(원/돈)는 0 이상의 숫자로 입력하세요.");
      return;
    }
    const quotePerDon = Math.floor(n);
    const ledgerFields = yijeLedgerFieldsForPurchase(quotePerDon, p);
    if (ledgerFields == null) {
      setError("의제 마진 계산에 필요한 중량·매입금액을 확인하세요.");
      return;
    }
    const storedQuote =
      p.gold_price_per_don != null &&
      Number.isFinite(Number(p.gold_price_per_don))
        ? Math.round(Number(p.gold_price_per_don))
        : null;
    const storedProcessing =
      p.processing_price_per_don != null &&
      Number.isFinite(Number(p.processing_price_per_don))
        ? Math.round(Number(p.processing_price_per_don))
        : null;
    const storedMargin =
      p.margin_amount != null && Number.isFinite(Number(p.margin_amount))
        ? Math.round(Number(p.margin_amount))
        : null;
    if (
      storedQuote === ledgerFields.gold_price_per_don &&
      storedProcessing === ledgerFields.processing_price_per_don &&
      storedMargin === ledgerFields.margin_amount
    ) {
      return;
    }

    setYijeQuoteSavingId(p.id);
    setError(null);
    const { error: ue } = await supabase
      .from("purchases")
      .update({
        gold_price_per_don: ledgerFields.gold_price_per_don,
        processing_price_per_don: ledgerFields.processing_price_per_don,
        margin_amount: ledgerFields.margin_amount,
      })
      .eq("id", p.id);
    setYijeQuoteSavingId(null);
    if (ue) {
      setError(ue.message);
      return;
    }
    setYijeQuoteEdits((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    await load();
    setProfitPanelReloadToken((t) => t + 1);
  }

  const monthlyLedgerClipboardCopy = useMemo(
    () => ({
      columnHeaders: MONTHLY_LEDGER_CLIPBOARD_HEADERS,
      includeHeaderRow: false,
      /** 맨 오른쪽 수정/삭제 버튼 열만 복사 제외 */
      omitLeadingDataColumns: 0,
      omitTrailingDataColumns: 2,
    }),
    [],
  );

  const monthlyLedgerTableColSpan = 14;

  function displayBranchName(name: string) {
    return name === "본점" ? "향남점" : name;
  }

  const canAdminPickBranch = isAdmin;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-3 sm:px-4 lg:px-5">
      <div className="purchase-ledger-page space-y-5">
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
      {negativeMarginCount > 0 ? (
        <div
          role="alert"
          className="toss-alert-error rounded-xl px-4 py-3.5 text-base font-semibold leading-snug"
        >
          마진이 음수로 표시된 건이 {negativeMarginCount}건 있습니다. 매입금액/처리원가(처리시세) 입력값을
          확인하세요.
        </div>
      ) : null}

      <PurchaseLedgersChrome variant="fintech">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch lg:gap-5">
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

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="purchase-ledger-section-label">{formatLedgerYearLabel(selectedYear)}</p>
              <button
                type="button"
                onClick={() => {
                  setFromDate(`${selectedYear}-01-01`);
                  setToDate(`${selectedYear}-12-31`);
                  setView("yearTotal");
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
              branchId={branchId}
              reloadToken={profitPanelReloadToken}
              variant="purchase-ledger"
            />
          </section>

          <section className="purchase-ledger-work-card flex h-full min-w-0 flex-col">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <div className="min-w-[8rem] flex-1">
                <label className="purchase-ledger-field-label" htmlFor="purchase-branch">
                  지점
                </label>
                <select
                  id="purchase-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  disabled={!canAdminPickBranch}
                  className="purchase-ledger-field-input"
                >
                  {branchesForShopSelect(branches).map((b) => (
                    <option key={b.id} value={b.id}>
                      {displayBranchName(b.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="purchase-ledger-field-label" htmlFor="purchase-from">
                  시작일
                </label>
                <input
                  id="purchase-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="purchase-ledger-field-input tabular-nums"
                />
              </div>
              <div>
                <label className="purchase-ledger-field-label" htmlFor="purchase-to">
                  종료일
                </label>
                <input
                  id="purchase-to"
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
              <p className="purchase-ledger-section-label">오늘의 처리시세</p>
              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
                <div>
                  <label className="purchase-ledger-field-label" htmlFor="processing-date">
                    기준일
                  </label>
                  <input
                    id="processing-date"
                    type="date"
                    value={processingQuoteDate}
                    onChange={(e) => setProcessingQuoteDate(e.target.value)}
                    className="purchase-ledger-field-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="purchase-ledger-field-label" htmlFor="processing-price">
                    처리시세(원/돈)
                  </label>
                  <input
                    id="processing-price"
                    value={formatWonInputDisplay(processingPriceDigits)}
                    onChange={(e) =>
                      setProcessingPriceDigits(sanitizeWonInputDigits(e.target.value))
                    }
                    placeholder="예: 428000"
                    className="purchase-ledger-field-input w-44 tabular-nums"
                    inputMode="numeric"
                  />
                </div>
                <button
                  type="button"
                  disabled={processingApplyBusy || processingQuoteLoading || !branchId}
                  onClick={() => void applyProcessingQuoteToDay()}
                  className="purchase-ledger-btn-primary"
                >
                  {processingApplyBusy ? "반영 중…" : "저장 후 장부 반영"}
                </button>
              </div>
              <div className="mt-2 min-h-[1.25rem] text-xs text-[#8b95a1]">
                {processingQuoteLoading ? (
                  "불러오는 중…"
                ) : processingSaved ? (
                  <>
                    저장 {formatKRW(Number(processingSaved.price_per_don))}원/돈 ·{" "}
                    {formatDateTime(processingSaved.updated_at)}
                  </>
                ) : branchId ? (
                  "이 날짜에 저장된 시세 없음"
                ) : null}
              </div>
            </div>

            <div className="purchase-ledger-stat-block">
              <div className="flex flex-wrap gap-8 sm:gap-12">
                <div className="min-w-[10rem]">
                  <p className="purchase-ledger-stat-label">선택 기간 마진 합계</p>
                  <p className="purchase-ledger-stat-value purchase-ledger-stat-value-accent">
                    {loading ? "…" : formatKRW(marginSum)}
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
      </PurchaseLedgersChrome>

      {view === "yearTotal" && yearSummary ? (
        <section className="purchase-ledger-work-card">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">{formatLedgerYearLabel(selectedYear)} 연합계</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            선택 지점 기준으로, 월별 건수/마진 합계를 보여줍니다(금매입).
          </p>
          {lastLoadInfo ? (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              조회범위 {lastLoadInfo.rangeFrom}~{lastLoadInfo.rangeTo} · rows {lastLoadInfo.rowCount}건 ·
              서울일자 {lastLoadInfo.minYmdSeoul ?? "—"}~{lastLoadInfo.maxYmdSeoul ?? "—"}
            </p>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-3 py-3">
              <p className="text-xs font-medium text-[var(--muted)]">연 마진 합계</p>
              <p className="mt-1 text-xl font-semibold text-amber-900">
                {formatKRW(yearSummary.total.marginSum)}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-3 py-3">
              <p className="text-xs font-medium text-[var(--muted)]">연 건수</p>
              <p className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                {yearSummary.total.count}건
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

      <section className="purchase-ledger-work-card flex min-h-[50vh] w-full flex-col overflow-hidden lg:min-h-[calc(100dvh-13rem)]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="purchase-ledger-section-label">월매입 장부</h2>
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
              <div className="relative shrink-0">
                <input
                  type="search"
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  placeholder="고객명·전화·제품명 (전체 검색)"
                  aria-label="고객명·전화번호·제품명(함량·특이사항)으로 월매입 장부 전체 검색"
                  title="입력하면 조회 월·연도를 무시하고 이 매장 매입 전체에서 찾습니다"
                  className="purchase-ledger-field-input !mt-0 h-8 w-[12rem] !px-2.5 !pr-7 !text-xs"
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
            </div>
          </div>
          <p className="text-xs font-medium tabular-nums text-[#8b95a1]">
            {loading
              ? "…"
              : ledgerTodayOnly || ledgerSearch.trim().length > 0
                ? `${ledgerRowsSorted.length}건 · 매입 ${formatKRW(ledgerTableAmountSum)} · 이익 ${formatKRW(ledgerTableMarginSum)} (${[
                    ledgerTodayOnly ? "오늘" : "",
                    ledgerSearch.trim().length > 0 ? "전체검색" : "",
                  ]
                    .filter(Boolean)
                    .join("·")})`
                : `${rows.length}건 · 매입 ${formatKRW(ledgerAmountSum)} · 이익 ${formatKRW(ledgerTableMarginSum)}`}
          </p>
        </div>
        <div
          ref={monthlyLedgerSumRef}
          className="relative min-h-0 flex-1 overflow-auto pt-2"
        >
          <LedgerSelectionSumBar
            rootRef={monthlyLedgerSumRef}
            clipboardCopy={monthlyLedgerClipboardCopy}
          />
          <table className="monthly-purchase-ledger-table ledger-cell-select w-full min-w-0 table-fixed cursor-cell select-none border-separate border-spacing-0 text-center tabular-nums">
            <colgroup>
              <col className="w-[3.75rem]" />
              <col className="w-[4.25rem]" />
              <col className="w-[5.25rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[3rem]" />
              <col className="w-[5rem]" />
              <col className="w-[5rem]" />
              <col className="monthly-purchase-ledger-col-margin" />
              <col className="monthly-purchase-ledger-col-quote" />
              <col className="w-[3rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[2.75rem]" />
              <col className="w-[2.75rem]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f2f4f6] font-semibold text-[#8b95a1] shadow-[0_1px_0_0_#e8ebef] dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)] dark:shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th className="whitespace-nowrap">날짜</th>
                <th>고객명</th>
                <th className="whitespace-nowrap">전화번호</th>
                <th className="whitespace-nowrap">중량(g)</th>
                <th className="whitespace-nowrap">순금</th>
                <th>함량</th>
                <th className="whitespace-nowrap">매입금액</th>
                <th className="whitespace-nowrap">처리원가</th>
                <th className="whitespace-nowrap">마진</th>
                <th
                  className="whitespace-nowrap"
                  title="일반: 등록 시세·일반 마진. 의제: 수기 매입시세 저장 시 전용 마진(기준마진−부가세10%−24K-1 1만×돈)."
                >
                  매입시세
                </th>
                <th>결제</th>
                <th>특이사항</th>
                <th className="whitespace-nowrap">수정</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={monthlyLedgerTableColSpan}
                    className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={monthlyLedgerTableColSpan}
                    className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    이 기간에 매입이 없습니다.
                  </td>
                </tr>
              ) : ledgerRowsSorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={monthlyLedgerTableColSpan}
                    className="px-3 py-10 text-center text-sm text-[var(--muted)]"
                  >
                    {ledgerSearch.trim().length > 0
                      ? "검색 결과가 없습니다."
                      : ledgerTodayOnly
                        ? "오늘 날짜 매입이 없습니다."
                        : "표시할 매입이 없습니다."}
                  </td>
                </tr>
              ) : (
                ledgerRowsSorted.map((p, i) => {
                  const prev = i > 0 ? ledgerRowsSorted[i - 1] : null;
                  const phoneDisp =
                    p.seller_phone?.trim() != null && p.seller_phone !== ""
                      ? normalizeKoreanMobilePhone(p.seller_phone)
                      : "";
                  const goldLike = p.item_type === "금";
                  const donWeightLike = goldLike || p.item_type === "은";
                  const w = p.weight_g != null ? Number(p.weight_g) : NaN;
                  const wForDon =
                    goldLike
                      ? effectiveWeightGForGoldPurchase(
                          normalizeKarat(p.karat ?? p.purity) ??
                            String(p.karat ?? p.purity ?? "").trim(),
                          w,
                        )
                      : w;
                  const excelLikePurityFactor = (() => {
                    const k = normalizeKarat(p.karat ?? p.purity);
                    if (k == null) return null;
                    const t = String(k).trim().toUpperCase();
                    if (t === "24K" || t === "24K-1") return 1;
                    // match user's legacy Excel factors (slightly different from KARAT_FACTORS)
                    if (t === "18K") return 0.738;
                    if (t === "14K") return 0.573;
                    if (t === "10K") return 0.417;
                    if (t === "크라운" || t === "인레이") return 0.738;
                    // 외국금 등은 장부 로직처럼 weight 보정만 적용하고 계수는 1로 둔다
                    return t === "외국금" ? 1 : null;
                  })();
                  const kForDon = normalizeKarat(p.karat ?? p.purity);
                  const donNumForLedger =
                    kForDon === "외국금" &&
                    p.pure_gold_don != null &&
                    Number.isFinite(Number(p.pure_gold_don)) &&
                    Number(p.pure_gold_don) > 0
                      ? Number(Number(p.pure_gold_don).toFixed(2))
                      : donWeightLike &&
                          excelLikePurityFactor != null &&
                          Number.isFinite(w) &&
                          w > 0
                        ? Number(
                            ((Number(wForDon) / 3.75) * excelLikePurityFactor).toFixed(
                              2,
                            ),
                          )
                        : NaN;
                  const donFromG =
                    Number.isFinite(donNumForLedger) && donNumForLedger > 0
                      ? donNumForLedger.toFixed(2)
                      : "—";
                  const storedProcessingWon =
                    p.processing_price_per_don != null &&
                    Number.isFinite(Number(p.processing_price_per_don))
                      ? Number(p.processing_price_per_don)
                      : null;
                  const storedMarginWon =
                    p.margin_amount != null && Number.isFinite(Number(p.margin_amount))
                      ? Number(p.margin_amount)
                      : null;
                  const quotePerDon =
                    p.gold_price_per_don != null &&
                    Number.isFinite(Number(p.gold_price_per_don))
                      ? Number(p.gold_price_per_don)
                      : null;
                  const kForDisplay = normalizeKarat(p.karat ?? p.purity);
                  const isYijeRow = p.payment_method === "의제";
                  const purchaseYmdSeoul = seoulYmdFromIso(p.purchased_at);
                  const use24K1LiveProcessing =
                    purchaseYmdSeoul >= LEDGER_24K1_RECALC_DISPLAY_FROM_SEOUL_YMD;
                  let displayProcessingWon = storedProcessingWon;
                  if (
                    !isYijeRow &&
                    use24K1LiveProcessing &&
                    goldLike &&
                    kForDisplay === "24K-1" &&
                    quotePerDon != null &&
                    Number.isFinite(donNumForLedger) &&
                    donNumForLedger > 0
                  ) {
                    const effPerDon = Math.max(
                      0,
                      quotePerDon - PROCESSING_QUOTE_OFFSET_PER_DON_24K1,
                    );
                    displayProcessingWon = Math.round(
                      effPerDon * donNumForLedger,
                    );
                  }
                  const displayMarginWon = isYijeRow
                    ? storedMarginWon
                    : displayProcessingWon != null &&
                        Number.isFinite(Number(p.total_amount))
                      ? Math.round(
                          displayProcessingWon - Number(p.total_amount),
                        )
                      : storedMarginWon;
                  const totalAmt = Number(p.total_amount);
                  const totalAmtRounded =
                    Number.isFinite(totalAmt) ? Math.round(totalAmt) : null;
                  const processingRounded =
                    displayProcessingWon != null &&
                    Number.isFinite(displayProcessingWon)
                      ? Math.round(displayProcessingWon)
                      : null;
                  const marginRounded =
                    displayMarginWon != null && Number.isFinite(displayMarginWon)
                      ? Math.round(displayMarginWon)
                      : null;
                  const isNegativeMargin =
                    marginRounded != null && Number.isFinite(marginRounded) && marginRounded < 0;
                  const weightNum =
                    p.weight_g != null ? Number(p.weight_g) : NaN;
                  const weightSumAttr =
                    Number.isFinite(weightNum) ? String(weightNum) : null;
                  const ymd = seoulYmdFromIso(p.purchased_at);
                  const prevYmd =
                    prev != null ? seoulYmdFromIso(prev.purchased_at) : null;
                  const showDate = prevYmd == null || ymd !== prevYmd;
                  return (
                    <tr
                      key={p.id}
                      data-ledger-row={p.id}
                      className={`hover:bg-gray-100/80 dark:hover:bg-gray-800/40 ${isNegativeMargin ? "bg-rose-50/70 dark:bg-rose-950/30" : ""}`}
                    >
                      <td
                        className="whitespace-nowrap text-center text-[var(--foreground)]"
                        data-clipboard-text={showDate ? ymd : ""}
                      >
                        {showDate ? formatMonthlyLedgerMoDay(p.purchased_at) : ""}
                      </td>
                      <td className="max-w-[6rem] truncate text-[var(--foreground)]">
                        {p.seller_name != null && String(p.seller_name).trim() !== ""
                          ? p.seller_name
                          : "—"}
                      </td>
                      <td className="max-w-[7rem] whitespace-nowrap text-[var(--foreground)]">
                        {phoneDisp || "—"}
                      </td>
                      <td
                        className="tabular-nums text-[var(--foreground)]"
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
                      <td
                        className="font-medium tabular-nums text-[var(--foreground)]"
                        {...(totalAmtRounded != null
                          ? { "data-sum-won": String(totalAmtRounded) }
                          : {})}
                      >
                        {formatKRW(Number(p.total_amount))}
                      </td>
                      <td
                        className="tabular-nums text-[var(--foreground)]"
                        {...(processingRounded != null
                          ? { "data-sum-won": String(processingRounded) }
                          : {})}
                      >
                        {displayProcessingWon != null
                          ? formatKRW(displayProcessingWon)
                          : "—"}
                      </td>
                      <td
                        className={`monthly-purchase-ledger-margin tabular-nums ${isNegativeMargin ? "monthly-purchase-ledger-margin-negative" : ""}`}
                        {...(marginRounded != null
                          ? { "data-sum-won": String(marginRounded) }
                          : {})}
                      >
                        {displayMarginWon != null
                          ? formatKRW(displayMarginWon)
                          : "—"}
                      </td>
                      <td
                        className="tabular-nums text-[var(--foreground)]"
                        {...(quotePerDon != null
                          ? {
                              "data-ledger-copy-won": String(
                                Math.round(quotePerDon),
                              ),
                            }
                          : {})}
                      >
                        {p.payment_method === "의제" && isAdmin ? (
                          <input
                            value={formatWonInputDisplay(
                              yijeQuoteDigitsForRow(p),
                            )}
                            onChange={(e) =>
                              setYijeQuoteEdits((prev) => ({
                                ...prev,
                                [p.id]: sanitizeWonInputDigits(e.target.value),
                              }))
                            }
                            onBlur={() => void saveYijePurchaseQuote(p)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void saveYijePurchaseQuote(p);
                              }
                            }}
                            disabled={yijeQuoteSavingId === p.id}
                            className="mx-auto h-7 w-full max-w-[5rem] min-w-0 rounded border border-amber-200 bg-[var(--card)] px-1 text-center text-xs tabular-nums text-[var(--foreground)] outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-400/40 disabled:opacity-50 dark:border-amber-700/50"
                            placeholder="원/돈"
                            inputMode="numeric"
                            title="결제=의제 · 매입시세 수기 입력 (Enter 또는 포커스 나가면 저장)"
                          />
                        ) : quotePerDon != null ? (
                          formatKRW(quotePerDon)
                        ) : p.payment_method === "의제" ? (
                          <span className="text-[var(--muted)]">미입력</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-[var(--foreground)]">
                        {p.payment_method ?? "—"}
                      </td>
                      <td className="max-w-[8rem] truncate text-[var(--muted)]">
                        {p.note != null && String(p.note).trim() !== ""
                          ? p.note
                          : "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setEditingPurchase(p)}
                          className="text-xs text-amber-800 hover:underline dark:text-amber-300"
                        >
                          수정
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => void handleDeletePurchase(p.id)}
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
            {!loading && ledgerRowsSorted.length > 0 ? (
              <tfoot className="sticky bottom-0 z-[5] border-t-2 border-[#e8ebef] bg-[#f9fafb]/95 font-semibold text-[#191f28] shadow-[0_-1px_0_0_#e8ebef] dark:border-[var(--border)] dark:bg-[var(--surface-subtle)]/95 dark:text-[var(--foreground)]">
                <tr>
                  <td
                    colSpan={6}
                    className="text-right text-xs font-semibold text-[#191f28] dark:text-[var(--foreground)]"
                  >
                    합계
                    {updating ? (
                      <span className="ml-2 font-medium text-[#8b95a1] dark:text-[var(--muted)]">
                        (업데이트 중…)
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap text-center tabular-nums text-[#191f28] dark:text-[var(--foreground)]">
                    {formatKRW(ledgerTableAmountSum)}
                  </td>
                  <td />
                  <td className="monthly-purchase-ledger-margin whitespace-nowrap text-center tabular-nums">
                    {formatKRW(ledgerTableMarginSum)}
                  </td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      <PurchaseEditDialog
        supabase={supabase}
        purchase={editingPurchase}
        userId={profile?.id ?? ""}
        open={editingPurchase != null}
        onClose={() => setEditingPurchase(null)}
        onSaved={() => void load()}
      />
      </div>
    </div>
  );
}

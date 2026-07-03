"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatDateTime,
  formatKRW,
  formatWonInputDisplay,
  localYmdFromIso,
  parseWonDigitsToNumber,
  purchaseLedgerDateCellParts,
  sanitizeWonInputDigits,
  seoulYmdFromIso,
  seoulYmdToUtcRangeIso,
  formatLedgerYearLabel,
} from "@/lib/format";
import {
  branchLabelForId,
  branchesForShopSelect,
  firstShopSelectableBranchId,
} from "@/lib/branchLabels";
import {
  chigumKindLabelFromPurchase,
  chigumPureDonFromWeightG,
} from "@/lib/chigumPurchase";
import { jongroDailyQuotesSetupHint } from "@/lib/purchaseMargin";
import { normalizeKoreanMobilePhone } from "@/lib/koreanPhone";
import { LedgerSelectionSumBar } from "@/components/LedgerSelectionSumBar";
import { PurchaseLedgersChrome } from "@/components/PurchaseLedgersChrome";
import {
  JONGRO_QUOTE_SCOPE_CHIGUM,
  type Branch,
  type ProcessingDailyQuote,
  type Profile,
  type Purchase,
} from "@/types/db";

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

/** 치금 월별 시세 DB 키 — jongro_daily_quotes.quote_date = 매월 1일 */
function chigumMonthlyQuoteDateKey(year: number, month: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-01`;
}

function formatChigumMonthLabel(year: number, month: number): string {
  return `${year}년 ${month}월`;
}

function purchaseLedgerToolbarPill(active: boolean) {
  return active
    ? "tongsang-pill tongsang-pill-active px-3 py-1.5 text-xs"
    : "tongsang-pill tongsang-pill-inactive px-3 py-1.5 text-xs";
}

function chigumKindLabel(p: Purchase): string {
  return chigumKindLabelFromPurchase(p);
}

/**
 * 건당 처리원가·마진. 해당 월에 저장된 치금 매입시세(원/돈)로 계산한다.
 */
function chigumRowProcessingAndMargin(
  p: Purchase,
  monthlyQuotePerDon: number | null,
): { processingWon: number | null; marginWon: number | null } {
  if (p.item_type !== "치금") {
    return { processingWon: null, marginWon: null };
  }
  const w =
    p.weight_g != null && Number.isFinite(Number(p.weight_g))
      ? Number(p.weight_g)
      : NaN;
  if (!Number.isFinite(w) || w <= 0) {
    return { processingWon: null, marginWon: null };
  }
  const preferredOk =
    monthlyQuotePerDon != null &&
    Number.isFinite(monthlyQuotePerDon) &&
    monthlyQuotePerDon > 0;
  const rowQuote =
    p.gold_price_per_don != null &&
    Number.isFinite(Number(p.gold_price_per_don)) &&
    Number(p.gold_price_per_don) > 0
      ? Number(p.gold_price_per_don)
      : null;
  const q = preferredOk ? Number(monthlyQuotePerDon) : rowQuote;
  if (q == null) {
    return { processingWon: null, marginWon: null };
  }
  const kind = chigumKindLabel(p);
  const pureDon = chigumPureDonFromWeightG(w, kind);
  const processingWon = Math.round(pureDon * q);
  const purchase = Number.isFinite(Number(p.total_amount))
    ? Math.round(Number(p.total_amount))
    : 0;
  return {
    processingWon,
    marginWon: processingWon - purchase,
  };
}

export default function ChigumLedgerPage() {
  const chigumLedgerSumRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const initial = monthRange();
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const LS_YEARS = "chigumLedger_yearFolders";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
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
  const [ledgerDateSortAsc, setLedgerDateSortAsc] = useState(false);
  const [ledgerTodayOnly, setLedgerTodayOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [processingPriceDigits, setProcessingPriceDigits] = useState("");
  const [processingSaved, setProcessingSaved] = useState<ProcessingDailyQuote | null>(null);
  const [processingQuoteLoading, setProcessingQuoteLoading] = useState(false);
  const [processingApplyBusy, setProcessingApplyBusy] = useState(false);
  /** YYYY-MM → 원/돈. 행별 해당 월 저장 시세로 마진 계산 */
  const [monthlyChigumQuotes, setMonthlyChigumQuotes] = useState<
    Record<string, number>
  >({});

  const processingQuoteMonthKey = useMemo(
    () => chigumMonthlyQuoteDateKey(selectedYear, selectedMonth),
    [selectedYear, selectedMonth],
  );
  const processingMonthLabel = useMemo(
    () => formatChigumMonthLabel(selectedYear, selectedMonth),
    [selectedYear, selectedMonth],
  );
  const hasSavedMonthlyQuote = useMemo(() => {
    const ym = processingQuoteMonthKey.slice(0, 7);
    const mapped = monthlyChigumQuotes[ym];
    if (mapped != null && mapped > 0) return true;
    return processingSaved != null;
  }, [monthlyChigumQuotes, processingQuoteMonthKey, processingSaved]);

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
    setLoading(true);
    setError(null);
    setMsg(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: prof, error: pe } = await supabase
      .from("profiles")
      .select("id, full_name, role, branch_id")
      .eq("id", user.id)
      .maybeSingle();
    if (pe) {
      setError(pe.message);
      setLoading(false);
      return;
    }
    setProfile(prof as Profile);

    const { data: br, error: be } = await supabase
      .from("branches")
      .select("id, name, created_at")
      .order("name");
    if (be) {
      setError(be.message);
      setLoading(false);
      return;
    }
    const list = (br ?? []) as Branch[];
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
      setRows([]);
      setLoading(false);
      return;
    }
    if ((prof as Profile).role === "admin") {
      setBranchId(adminChosen);
    } else if (!branchId) {
      setBranchId(effectiveBranchId);
    }

    const fromIso = new Date(`${fromDate}T00:00:00`).toISOString();
    const toIso = new Date(`${toDate}T23:59:59.999`).toISOString();

    const { data: pu, error: pue } = await supabase
      .from("purchases")
      .select("*, branches(name)")
      .eq("branch_id", effectiveBranchId)
      .eq("item_type", "치금")
      .gte("purchased_at", fromIso)
      .lte("purchased_at", toIso)
      .order("purchased_at", { ascending: true });
    if (pue) {
      setError(pue.message);
      setLoading(false);
      return;
    }
    setRows((pu ?? []) as Purchase[]);
    setLoading(false);
  }, [supabase, branchId, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMonthlyChigumQuotes = useCallback(async () => {
    if (!branchId) {
      setMonthlyChigumQuotes({});
      return;
    }
    const { data, error: qe } = await supabase
      .from("jongro_daily_quotes")
      .select("quote_date, price_per_don")
      .eq("branch_id", branchId)
      .eq("quote_scope", JONGRO_QUOTE_SCOPE_CHIGUM);
    if (qe) {
      setMonthlyChigumQuotes({});
      return;
    }
    const map: Record<string, number> = {};
    for (const row of data ?? []) {
      const ym = String(row.quote_date).slice(0, 7);
      const price = Number(row.price_per_don);
      if (Number.isFinite(price) && price > 0) map[ym] = Math.round(price);
    }
    setMonthlyChigumQuotes(map);
  }, [supabase, branchId]);

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
      .eq("quote_date", processingQuoteMonthKey)
      .eq("quote_scope", JONGRO_QUOTE_SCOPE_CHIGUM)
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
  }, [supabase, branchId, processingQuoteMonthKey]);

  useEffect(() => {
    void loadMonthlyChigumQuotes();
  }, [loadMonthlyChigumQuotes]);

  useEffect(() => {
    void loadProcessingQuote();
  }, [loadProcessingQuote]);

  useEffect(() => {
    if (view !== "month") return;
    const r = monthDateRange(selectedYear, selectedMonth);
    setFromDate(r.from);
    setToDate(r.to);
  }, [selectedMonth, selectedYear, view]);

  const yearSummary = useMemo(() => {
    if (view !== "yearTotal") return null;
    const map: Record<number, { count: number; amountSum: number }> = {};
    for (let m = 1; m <= 12; m++) map[m] = { count: 0, amountSum: 0 };
    for (const p of rows) {
      const d = new Date(p.purchased_at);
      const y = d.getFullYear();
      if (y !== selectedYear) continue;
      const m = d.getMonth() + 1;
      const amt = Number.isFinite(Number(p.total_amount)) ? Math.round(Number(p.total_amount)) : 0;
      map[m].count += 1;
      map[m].amountSum += amt;
    }
    const total = Object.values(map).reduce(
      (a, v) => ({ count: a.count + v.count, amountSum: a.amountSum + v.amountSum }),
      { count: 0, amountSum: 0 },
    );
    return { byMonth: map, total };
  }, [rows, selectedYear, view]);

  const ledgerAmountSum = useMemo(() => {
    return rows.reduce((a, p) => a + Number(p.total_amount), 0);
  }, [rows]);

  const ledgerRowsSorted = useMemo(() => {
    const todayYmd = localYmdFromIso(new Date().toISOString());
    const base = ledgerTodayOnly
      ? rows.filter((p) => localYmdFromIso(p.purchased_at) === todayYmd)
      : rows;
    const copy = [...base];
    copy.sort((a, b) => {
      const ta = new Date(a.purchased_at).getTime();
      const tb = new Date(b.purchased_at).getTime();
      if (ta !== tb) return ledgerDateSortAsc ? ta - tb : tb - ta;
      return String(a.id).localeCompare(String(b.id));
    });
    return copy;
  }, [rows, ledgerDateSortAsc, ledgerTodayOnly]);

  const ledgerTableAmountSum = useMemo(() => {
    return ledgerRowsSorted.reduce((a, p) => a + Number(p.total_amount), 0);
  }, [ledgerRowsSorted]);

  const chigumQuoteForPurchase = useCallback(
    (p: Purchase): number | null => {
      const ym = seoulYmdFromIso(p.purchased_at).slice(0, 7);
      const saved = monthlyChigumQuotes[ym];
      return saved != null && saved > 0 ? saved : null;
    },
    [monthlyChigumQuotes],
  );

  const kindPeriodSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        count: number;
        weightG: number;
        pureDonSum: number;
        amountSum: number;
        marginSum: number;
      }
    >();
    for (const p of rows) {
      const label = chigumKindLabel(p);
      const w =
        p.weight_g != null && Number.isFinite(Number(p.weight_g)) ? Number(p.weight_g) : 0;
      const paid = Number.isFinite(Number(p.total_amount)) ? Number(p.total_amount) : 0;
      const cur = map.get(label) ?? {
        count: 0,
        weightG: 0,
        pureDonSum: 0,
        amountSum: 0,
        marginSum: 0,
      };
      cur.count += 1;
      cur.weightG += w;
      cur.pureDonSum += chigumPureDonFromWeightG(w, label);
      cur.amountSum += paid;
      const { marginWon } = chigumRowProcessingAndMargin(
        p,
        chigumQuoteForPurchase(p),
      );
      if (marginWon != null && Number.isFinite(marginWon)) {
        cur.marginSum += marginWon;
      }
      map.set(label, cur);
    }
    const summaryRows = [...map.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], "ko"),
    );
    const totalW = summaryRows.reduce((s, [, v]) => s + v.weightG, 0);
    const totalPureDon = summaryRows.reduce((s, [, v]) => s + v.pureDonSum, 0);
    const totalAmt = summaryRows.reduce((s, [, v]) => s + v.amountSum, 0);
    const totalMargin = summaryRows.reduce((s, [, v]) => s + v.marginSum, 0);
    const totalCnt = summaryRows.reduce((s, [, v]) => s + v.count, 0);
    return { summaryRows, totalW, totalPureDon, totalAmt, totalMargin, totalCnt };
  }, [rows, chigumQuoteForPurchase]);

  const ledgerTableMarginSum = useMemo(() => {
    return ledgerRowsSorted.reduce((a, p) => {
      const { marginWon } = chigumRowProcessingAndMargin(
        p,
        chigumQuoteForPurchase(p),
      );
      if (marginWon == null || !Number.isFinite(marginWon)) return a;
      return a + marginWon;
    }, 0);
  }, [ledgerRowsSorted, chigumQuoteForPurchase]);

  const marginSum = useMemo(() => {
    return rows.reduce((a, p) => {
      const { marginWon } = chigumRowProcessingAndMargin(
        p,
        chigumQuoteForPurchase(p),
      );
      if (marginWon == null || !Number.isFinite(marginWon)) return a;
      return a + marginWon;
    }, 0);
  }, [rows, chigumQuoteForPurchase]);

  async function applyChigumMonthlyQuote() {
    if (!branchId) {
      setError("지점을 먼저 선택하세요.");
      return;
    }
    const price = parseWonDigitsToNumber(processingPriceDigits);
    if (price == null || price < 0) {
      setError("매입시세(원/돈)를 숫자로 입력하세요.");
      return;
    }
    if (
      !confirm(
        `${processingMonthLabel} · ${formatKRW(price)}원/돈을 저장하고, 해당 월 치금 매입 건의 처리시세·처리원가·마진을 이 기준으로 다시 계산합니다. 계속할까요?`,
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
        quote_date: processingQuoteMonthKey,
        quote_scope: JONGRO_QUOTE_SCOPE_CHIGUM,
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

    const { from, to } = monthDateRange(selectedYear, selectedMonth);
    const { from: fromIso, to: toIso } = seoulYmdToUtcRangeIso(from);
    const toRange = seoulYmdToUtcRangeIso(to);

    const { data: purchases, error: pe } = await supabase
      .from("purchases")
      .select("id, item_type, total_amount, weight_g, karat, purity, purchased_at, branch_id")
      .eq("branch_id", branchId)
      .gte("purchased_at", fromIso)
      .lte("purchased_at", toRange.to)
      .eq("item_type", "치금");

    if (pe) {
      setError(pe.message);
      setProcessingApplyBusy(false);
      return;
    }

    const list = ((purchases ?? []) as Purchase[]).filter((p) => {
      const ymd = seoulYmdFromIso(p.purchased_at);
      return ymd >= from && ymd <= to;
    });
    const patches: { id: string; patch: Record<string, unknown> }[] = [];
    let skipped = 0;
    for (const p of list) {
      const { processingWon, marginWon } = chigumRowProcessingAndMargin(p, price);
      if (processingWon == null || marginWon == null) {
        skipped += 1;
        continue;
      }
      patches.push({
        id: p.id,
        patch: {
          gold_price_per_don: price,
          processing_price_per_don: processingWon,
          margin_amount: marginWon,
        },
      });
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
      `${processingMonthLabel} 치금 매입시세 저장 및 반영 완료: ${patches.length}건 업데이트` +
        (skipped > 0 ? ` (${skipped}건 스킵)` : ""),
    );
    await loadMonthlyChigumQuotes();
    await loadProcessingQuote();
    await load();
  }

  async function handleDeletePurchase(id: string) {
    if (!confirm("이 매입 기록을 삭제할까요?")) return;
    const { error: de } = await supabase.from("purchases").delete().eq("id", id);
    if (de) {
      setError(de.message);
      return;
    }
    await load();
  }

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

            <div className="purchase-ledger-block-gap mt-4">
              <p className="purchase-ledger-section-label">함량별 요약 (선택 기간)</p>
              {loading ? (
                <p className="mt-2 text-center text-sm text-[#8b95a1]">불러오는 중…</p>
              ) : rows.length === 0 ? (
                <p className="mt-2 text-center text-sm text-[#8b95a1]">조회된 치금 매입이 없습니다.</p>
              ) : (
                <div className="mt-3 min-w-0 overflow-x-auto rounded-xl">
                  <table className="w-full min-w-0 table-fixed text-center text-[13px] tabular-nums sm:text-sm [&_td]:px-1.5 [&_td]:py-1.5 [&_th]:px-1.5 [&_th]:py-1.5">
                    <colgroup>
                      <col className="w-[14%]" />
                      <col className="w-[11%]" />
                      <col className="w-[16%]" />
                      <col className="w-[13%]" />
                      <col className="w-[23%]" />
                      <col className="w-[23%]" />
                    </colgroup>
                    <thead className="bg-[#f2f4f6] text-[13px] font-semibold text-[#8b95a1] sm:text-sm dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)]">
                      <tr>
                        <th>함량</th>
                        <th>건수</th>
                        <th>중량(g)</th>
                        <th>순금(돈)</th>
                        <th>매입 합계</th>
                        <th>마진 합계</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {kindPeriodSummary.summaryRows.map(([label, v]) => (
                        <tr key={label}>
                          <td className="truncate text-[var(--foreground)]">{label}</td>
                          <td className="whitespace-nowrap text-[var(--foreground)]">
                            {v.count}건
                          </td>
                          <td className="whitespace-nowrap text-[var(--foreground)]">
                            {v.weightG.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap text-[var(--foreground)]">
                            {v.pureDonSum.toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap font-medium text-[var(--foreground)]">
                            {formatKRW(Math.round(v.amountSum))}
                          </td>
                          <td className="monthly-purchase-ledger-margin whitespace-nowrap font-medium">
                            {formatKRW(Math.round(v.marginSum))}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-[#e8ebef] bg-[#f9fafb] font-medium dark:border-[var(--border)] dark:bg-[var(--surface-subtle)]">
                        <td className="text-[var(--foreground)]">합계</td>
                        <td className="whitespace-nowrap text-[var(--foreground)]">
                          {kindPeriodSummary.totalCnt}건
                        </td>
                        <td className="whitespace-nowrap text-[var(--foreground)]">
                          {kindPeriodSummary.totalW.toFixed(2)}
                        </td>
                        <td className="whitespace-nowrap text-[var(--foreground)]">
                          {kindPeriodSummary.totalPureDon.toFixed(2)}
                        </td>
                        <td className="whitespace-nowrap text-[var(--foreground)]">
                          {formatKRW(Math.round(kindPeriodSummary.totalAmt))}
                        </td>
                        <td className="purchase-ledger-stat-value-accent whitespace-nowrap font-semibold">
                          {formatKRW(Math.round(kindPeriodSummary.totalMargin))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="purchase-ledger-work-card flex h-full min-w-0 flex-col">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <div className="min-w-[8rem] flex-1">
                <label className="purchase-ledger-field-label" htmlFor="chigum-branch">
                  지점
                </label>
                <select
                  id="chigum-branch"
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
                <label className="purchase-ledger-field-label" htmlFor="chigum-from">
                  시작일
                </label>
                <input
                  id="chigum-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="purchase-ledger-field-input tabular-nums"
                />
              </div>
              <div>
                <label className="purchase-ledger-field-label" htmlFor="chigum-to">
                  종료일
                </label>
                <input
                  id="chigum-to"
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
              <p className="purchase-ledger-section-label">이번달 매입시세</p>
              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
                <div>
                  <label className="purchase-ledger-field-label">기준 월</label>
                  <p
                    id="chigum-processing-month"
                    className="purchase-ledger-field-input flex h-9 items-center tabular-nums text-[var(--foreground)]"
                  >
                    {processingMonthLabel}
                  </p>
                </div>
                <div>
                  <label className="purchase-ledger-field-label" htmlFor="chigum-processing-price">
                    매입시세(원/돈)
                  </label>
                  <input
                    id="chigum-processing-price"
                    value={formatWonInputDisplay(processingPriceDigits)}
                    onChange={(e) =>
                      setProcessingPriceDigits(sanitizeWonInputDigits(e.target.value))
                    }
                    placeholder="예: 700000"
                    className="purchase-ledger-field-input w-44 tabular-nums"
                    inputMode="numeric"
                  />
                </div>
                <button
                  type="button"
                  disabled={processingApplyBusy || processingQuoteLoading || !branchId}
                  onClick={() => void applyChigumMonthlyQuote()}
                  className="purchase-ledger-btn-primary disabled:opacity-50"
                >
                  {processingApplyBusy
                    ? hasSavedMonthlyQuote
                      ? "수정 중…"
                      : "저장 중…"
                    : hasSavedMonthlyQuote
                      ? "수정"
                      : "저장 후 장부 반영"}
                </button>
              </div>
              <div className="mt-2 min-h-[1.25rem] text-xs text-[#8b95a1]">
                {processingQuoteLoading ? (
                  "불러오는 중…"
                ) : processingSaved ? (
                  <>
                    {processingMonthLabel} 저장 {formatKRW(Number(processingSaved.price_per_don))}
                    원/돈 · {formatDateTime(processingSaved.updated_at)}
                  </>
                ) : branchId ? (
                  `${processingMonthLabel}에 저장된 치금 매입시세 없음`
                ) : null}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
                왼쪽에서 선택한 월 기준입니다. 저장 시 해당 월 치금 매입 건 전체에 반영되며,
                마진은 월별 저장 시세로 계산합니다.
              </p>
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
            선택 지점 기준으로, 월별 건수·매입 합계를 보여줍니다(치금매입).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--border)] bg-gray-50 px-3 py-3 dark:bg-gray-800/60">
              <p className="purchase-ledger-stat-label">연 매입 합계</p>
              <p className="purchase-ledger-stat-value purchase-ledger-stat-value-accent !text-2xl">
                {formatKRW(yearSummary.total.amountSum)}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-gray-50 px-3 py-3 dark:bg-gray-800/60">
              <p className="purchase-ledger-stat-label">연 건수</p>
              <p className="purchase-ledger-stat-value !text-2xl">
                {yearSummary.total.count}건
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[36rem] text-left text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-[var(--muted)] dark:bg-gray-800/60">
                <tr>
                  <th className="px-2 py-2 text-center">월</th>
                  <th className="px-2 py-2 text-center">건수</th>
                  <th className="px-2 py-2 text-center">매입 합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <tr key={m}>
                    <td className="px-2 py-2 text-center">{m}월</td>
                    <td className="px-2 py-2 text-center">{yearSummary.byMonth[m].count}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-[var(--foreground)]">
                      {formatKRW(yearSummary.byMonth[m].amountSum)}
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
            </div>
          </div>
          <p className="text-xs font-medium tabular-nums text-[#8b95a1]">
            {loading
              ? "…"
              : ledgerTodayOnly
                ? `${ledgerRowsSorted.length}건 · 매입 ${formatKRW(ledgerTableAmountSum)} · 이익 ${formatKRW(ledgerTableMarginSum)} (오늘)`
                : `${rows.length}건 · 매입 ${formatKRW(ledgerAmountSum)} · 이익 ${formatKRW(ledgerTableMarginSum)}`}
          </p>
        </div>
        <div
          ref={chigumLedgerSumRef}
          className="relative min-h-0 flex-1 overflow-auto pt-2"
        >
          <LedgerSelectionSumBar rootRef={chigumLedgerSumRef} />
          <table className="monthly-purchase-ledger-table ledger-cell-select w-full min-w-0 table-fixed cursor-cell select-none border-separate border-spacing-0 text-center tabular-nums">
            <colgroup>
              <col className="w-[3.75rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[2.75rem]" />
              <col className="w-[4.25rem]" />
              <col className="w-[5.25rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[3rem]" />
              <col className="w-[4.75rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[2.75rem]" />
              <col className="w-[2.75rem]" />
              <col className="w-[2.5rem]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f2f4f6] font-semibold text-[#8b95a1] shadow-[0_1px_0_0_#e8ebef] dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)] dark:shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th className="whitespace-nowrap">날짜</th>
                <th>매장</th>
                <th>품목</th>
                <th>고객명</th>
                <th className="whitespace-nowrap">전화</th>
                <th className="whitespace-nowrap">중량(g)</th>
                <th className="whitespace-nowrap">순금(돈)</th>
                <th>함량</th>
                <th className="whitespace-nowrap">매입금액</th>
                <th className="whitespace-nowrap">처리원가</th>
                <th className="whitespace-nowrap">마진</th>
                <th>결제</th>
                <th>특이사항</th>
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
                    오늘 날짜 매입이 없습니다.
                  </td>
                </tr>
              ) : (
                ledgerRowsSorted.map((p) => {
                  const phoneDisp =
                    p.seller_phone?.trim() != null && p.seller_phone !== ""
                      ? normalizeKoreanMobilePhone(p.seller_phone)
                      : "";
                  const w = p.weight_g != null ? Number(p.weight_g) : NaN;
                  const kind = chigumKindLabel(p);
                  const pureDon =
                    p.item_type === "치금" && Number.isFinite(w) && w > 0
                      ? chigumPureDonFromWeightG(w, kind)
                      : NaN;
                  const pureDonDisp =
                    Number.isFinite(pureDon) && pureDon > 0 ? pureDon.toFixed(2) : "—";
                  const { processingWon, marginWon } = chigumRowProcessingAndMargin(
                    p,
                    chigumQuoteForPurchase(p),
                  );
                  const totalAmt = Number(p.total_amount);
                  const totalAmtRounded =
                    Number.isFinite(totalAmt) ? Math.round(totalAmt) : null;
                  const weightNum =
                    p.weight_g != null ? Number(p.weight_g) : NaN;
                  const weightSumAttr =
                    Number.isFinite(weightNum) ? String(weightNum) : null;
                  const ledgerDt = purchaseLedgerDateCellParts(p.purchased_at);
                  const isNegativeMargin = marginWon != null && marginWon < 0;
                  return (
                    <tr
                      key={p.id}
                      data-ledger-row={p.id}
                      className="hover:bg-gray-100/80 dark:hover:bg-gray-800/40"
                    >
                      <td className="whitespace-nowrap text-center tabular-nums text-[var(--foreground)]">
                        <span className="block leading-tight">{ledgerDt.date}</span>
                        {ledgerDt.timeHm != null ? (
                          <span className="mt-0.5 block text-[10px] font-normal leading-none tabular-nums text-[var(--muted)]">
                            {ledgerDt.timeHm}
                          </span>
                        ) : null}
                      </td>
                      <td className="truncate text-[var(--foreground)]">
                        {branchLabelForId(branches, p.branch_id)}
                      </td>
                      <td className="text-[var(--foreground)]">{p.item_type}</td>
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
                        {...(Number.isFinite(pureDon) && pureDon > 0
                          ? { "data-sum-don": String(pureDon) }
                          : {})}
                      >
                        {pureDonDisp}
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
                        {...(processingWon != null
                          ? { "data-sum-won": String(processingWon) }
                          : {})}
                      >
                        {processingWon != null ? formatKRW(processingWon) : "—"}
                      </td>
                      <td
                        className={`monthly-purchase-ledger-margin tabular-nums ${isNegativeMargin ? "monthly-purchase-ledger-margin-negative" : ""}`}
                        {...(marginWon != null
                          ? { "data-sum-won": String(marginWon) }
                          : {})}
                      >
                        {marginWon != null ? formatKRW(marginWon) : "—"}
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
          </table>
        </div>
      </section>
      </div>
    </div>
  );
}

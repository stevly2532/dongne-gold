"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatKRW,
  localYmdFromIso,
  purchaseLedgerDateCellParts,
  formatLedgerYearLabel,
} from "@/lib/format";
import {
  branchLabelForId,
  branchesForShopSelect,
  firstShopSelectableBranchId,
} from "@/lib/branchLabels";
import { ledgerDisplayDonFromWeightG } from "@/lib/goldPurchase";
import { normalizeKoreanMobilePhone } from "@/lib/koreanPhone";
import { LedgerSelectionSumBar } from "@/components/LedgerSelectionSumBar";
import { PurchaseLedgersChrome } from "@/components/PurchaseLedgersChrome";
import { DailyBranchProfitPanel } from "@/components/DailyBranchProfitPanel";
import { PurchaseEditDialog } from "@/components/PurchaseEditDialog";
import { type Branch, type Profile, type Purchase } from "@/types/db";

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

function purchaseLedgerToolbarPill(active: boolean) {
  return active
    ? "tongsang-pill tongsang-pill-active px-3 py-1.5 text-xs"
    : "tongsang-pill tongsang-pill-inactive px-3 py-1.5 text-xs";
}

export default function PlatinumLedgerPage() {
  const platinumLedgerSumRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const initial = monthRange();
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const LS_YEARS = "platinumLedger_yearFolders";

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
  const [selectedMonth, setSelectedMonth] = useState<number>(
    () => new Date().getMonth() + 1,
  );
  const [view, setView] = useState<"month" | "yearTotal">("month");
  const [rows, setRows] = useState<Purchase[]>([]);
  const [ledgerDateSortAsc, setLedgerDateSortAsc] = useState(true);
  const [ledgerTodayOnly, setLedgerTodayOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
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
    setYearFolders((prev) =>
      Array.from(new Set([...prev, y])).sort((a, b) => a - b),
    );
    setSelectedYear(y);
    setView("month");
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      .eq("item_type", "백금")
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
    setProfitPanelReloadToken((t) => t + 1);
  }, [supabase, branchId, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

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
      const amt = Number.isFinite(Number(p.total_amount))
        ? Math.round(Number(p.total_amount))
        : 0;
      map[m].count += 1;
      map[m].amountSum += amt;
    }
    const total = Object.values(map).reduce(
      (a, v) => ({
        count: a.count + v.count,
        amountSum: a.amountSum + v.amountSum,
      }),
      { count: 0, amountSum: 0 },
    );
    return { byMonth: map, total };
  }, [rows, selectedYear, view]);

  const ledgerAmountSum = useMemo(() => {
    return rows.reduce((a, p) => a + Number(p.total_amount), 0);
  }, [rows]);

  const ledgerWeightSum = useMemo(() => {
    return rows.reduce((a, p) => {
      const w = p.weight_g != null ? Number(p.weight_g) : NaN;
      return Number.isFinite(w) ? a + w : a;
    }, 0);
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

  async function handleDeletePurchase(id: string) {
    if (!confirm("이 매입 기록을 삭제할까요?")) return;
    const { error: de } = await supabase.from("purchases").delete().eq("id", id);
    if (de) {
      setError(de.message);
      return;
    }
    await load();
  }

  const tableColSpan = 12;

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
                <label className="purchase-ledger-field-label" htmlFor="platinum-branch">
                  지점
                </label>
                <select
                  id="platinum-branch"
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
                <label className="purchase-ledger-field-label" htmlFor="platinum-from">
                  시작일
                </label>
                <input
                  id="platinum-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="purchase-ledger-field-input tabular-nums"
                />
              </div>
              <div>
                <label className="purchase-ledger-field-label" htmlFor="platinum-to">
                  종료일
                </label>
                <input
                  id="platinum-to"
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

            <div className="purchase-ledger-stat-block">
              <div className="flex flex-wrap gap-8 sm:gap-12">
                <div className="min-w-[10rem]">
                  <p className="purchase-ledger-stat-label">선택 기간 매입 합계</p>
                  <p className="purchase-ledger-stat-value purchase-ledger-stat-value-accent">
                    {loading ? "…" : formatKRW(ledgerAmountSum)}
                  </p>
                </div>
                <div className="min-w-[8rem]">
                  <p className="purchase-ledger-stat-label">중량 합계(g)</p>
                  <p className="purchase-ledger-stat-value">
                    {loading ? "…" : ledgerWeightSum.toFixed(2)}
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
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {formatLedgerYearLabel(selectedYear)} 연합계
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            선택 지점 기준으로, 월별 건수·매입 합계를 보여줍니다(백금매입).
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
                    <td className="px-2 py-2 text-center">
                      {yearSummary.byMonth[m].count}
                    </td>
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
                ? `${ledgerRowsSorted.length}건 · 매입 ${formatKRW(ledgerTableAmountSum)} (오늘)`
                : `${rows.length}건 · 매입 ${formatKRW(ledgerAmountSum)}`}
          </p>
        </div>
        <div
          ref={platinumLedgerSumRef}
          className="relative min-h-0 flex-1 overflow-auto pt-2"
        >
          <LedgerSelectionSumBar rootRef={platinumLedgerSumRef} />
          <table className="monthly-purchase-ledger-table ledger-cell-select w-full min-w-0 table-fixed cursor-cell select-none border-separate border-spacing-0 text-center tabular-nums">
            <colgroup>
              <col className="w-[3.75rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[2.75rem]" />
              <col className="w-[4.25rem]" />
              <col className="w-[5.25rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[3.25rem]" />
              <col className="w-[4.75rem]" />
              <col className="w-[3rem]" />
              <col className="w-[4.5rem]" />
              <col className="w-[2.75rem]" />
              <col className="w-[2.75rem]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f2f4f6] font-semibold text-[#8b95a1] shadow-[0_1px_0_0_#e8ebef] dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)] dark:shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th className="whitespace-nowrap">날짜</th>
                <th>매장</th>
                <th>품목</th>
                <th>고객명</th>
                <th className="whitespace-nowrap">전화</th>
                <th className="whitespace-nowrap">중량(g)</th>
                <th className="whitespace-nowrap">돈수</th>
                <th className="whitespace-nowrap">매입금액</th>
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
                    이 기간에 백금 매입이 없습니다.
                  </td>
                </tr>
              ) : ledgerRowsSorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableColSpan}
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
                  const donFromG =
                    Number.isFinite(w) && w > 0
                      ? ledgerDisplayDonFromWeightG(w).toFixed(2)
                      : "—";
                  const totalAmt = Number(p.total_amount);
                  const totalAmtRounded = Number.isFinite(totalAmt)
                    ? Math.round(totalAmt)
                    : null;
                  const weightSumAttr = Number.isFinite(w) ? String(w) : null;
                  const ledgerDt = purchaseLedgerDateCellParts(p.purchased_at);
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
                        {p.seller_name != null &&
                        String(p.seller_name).trim() !== ""
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
                      <td className="tabular-nums text-[var(--foreground)]">
                        {donFromG}
                      </td>
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
                      <td>
                        <button
                          type="button"
                          onClick={() => setEditingPurchase(p)}
                          className="text-xs text-amber-800 hover:underline"
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

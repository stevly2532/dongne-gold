"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppBootstrap } from "@/components/AppProviders";
import { HelpTooltip } from "@/components/HelpTooltip";
import { RegistrationPageHeader } from "@/components/RegistrationPageHeader";
import {
  branchesForShopSelect,
  branchSelectRowsForShop,
  firstShopSelectableBranchId,
} from "@/lib/branchLabels";
import { createClient } from "@/lib/supabase/client";
import { ledgerDisplayDonFromWeightG } from "@/lib/goldPurchase";
import {
  decodeTongsangShipmentSlot,
  encodeTongsangShipmentSlot,
  formatTongsangDon,
  formatTongsangEntryDateDisplay,
  formatTongsangGram,
  isMissingTongsangTable,
  parseTongsangCapturedDonInput,
  parseTongsangGramInput,
  TONGSANG_SETUP_HINT,
  TONGSANG_SHIPMENT_SLOT_COUNT,
  tongsangCapturedDonForKarat,
  tongsangCapturedDonLinesFromEntry,
  tongsangCapturedDonTotal,
  tongsangDonFromGramInput,
  tongsangPureDonFromGramInput,
  tongsangPureDonLinesFromEntry,
  tongsangPureDonTotal,
  tongsangShipmentSummary,
  type TongsangKaratDonLine,
  type TongsangKaratRow,
  type TongsangShipmentSlot,
} from "@/lib/tongsang";
import { todayYmdSeoul, formatLedgerYearLabel } from "@/lib/format";
import type { Branch, Profile, TongsangDailyEntry } from "@/types/db";

const LS_YEARS = "goldLedger_tongsangYearFolders";
const LS_BRANCH = "goldLedger_tongsangBranchId";

function tongsangDefaultBranchId(branches: Branch[]): string {
  const row = branchSelectRowsForShop(branches).find((r) => r.label === "향남점");
  return row?.id ?? firstShopSelectableBranchId(branches);
}

function readSavedTongsangBranchId(branches: Branch[]): string | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(LS_BRANCH);
    if (!saved) return null;
    const shop = branchesForShopSelect(branches);
    return shop.some((b) => b.id === saved) ? saved : null;
  } catch {
    return null;
  }
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

function displayBranchName(name: string) {
  return name === "본점" ? "향남점" : name;
}

function gramToInputString(g: number | null | undefined): string {
  if (g == null || !Number.isFinite(Number(g))) return "";
  const n = Number(g);
  if (n === 0) return "";
  return String(n);
}

const emptyShipmentSlots = (): TongsangShipmentSlot[] =>
  Array.from({ length: TONGSANG_SHIPMENT_SLOT_COUNT }, () => ({
    name: "",
    detail: "",
  }));

function donToInputString(don: number | null | undefined): string {
  if (don == null || !Number.isFinite(Number(don))) return "";
  const n = Number(don);
  if (n === 0) return "";
  return String(n);
}

/** 일별 기록 — 24K / 18K / 14K 함량별 한 줄씩 */
function TongsangKaratDonLines({
  lines,
  totalDon,
  emphasize,
  alignLeft = false,
}: {
  lines: TongsangKaratDonLine[];
  totalDon?: number | null;
  emphasize?: boolean;
  alignLeft?: boolean;
}) {
  if (lines.length === 0) {
    return <span className="text-[var(--muted)]">—</span>;
  }
  return (
    <div className={`flex flex-col gap-0.5 py-0.5 ${alignLeft ? "items-start" : "items-center"}`}>
      {lines.map(({ karat, don }) => (
        <div
          key={karat}
          className={`flex items-baseline gap-1.5 text-[10px] leading-tight tabular-nums sm:text-[11px] ${
            alignLeft ? "justify-start" : "justify-center"
          }`}
        >
          <span
            className={`shrink-0 font-medium text-[var(--muted)] ${
              alignLeft ? "w-[1.85rem] text-left" : "w-[1.85rem] text-right"
            }`}
          >
            {karat}
          </span>
          <span
            className={`min-w-[2.5rem] text-left font-medium ${
              emphasize ? "text-[#3182F6]" : "text-[var(--foreground)]"
            }`}
          >
            {Number(don).toFixed(2)}
          </span>
        </div>
      ))}
      {totalDon != null && Number.isFinite(totalDon) ? (
        <div className={`mt-0.5 flex items-baseline gap-1.5 border-t border-[var(--border)]/50 pt-0.5 text-[10px] font-bold leading-tight tabular-nums text-[#3182F6] sm:text-[11px] ${
          alignLeft ? "justify-start" : "justify-center"
        }`}>
          <span className="w-[1.85rem] shrink-0 text-right text-[var(--muted)]">합</span>
          <span className="min-w-[2.5rem] text-left">{Number(totalDon).toFixed(2)}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function TongsangPage() {
  const supabase = useMemo(() => createClient(), []);
  const bootstrap = useAppBootstrap();
  const initial = monthRange();
  const currentYear = new Date().getFullYear();

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

  const [entries, setEntries] = useState<TongsangDailyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [formDate, setFormDate] = useState(() => todayYmdSeoul());
  const [formPureG, setFormPureG] = useState("");
  const [formK18G, setFormK18G] = useState("");
  const [formK14G, setFormK14G] = useState("");
  const [formShipmentSlots, setFormShipmentSlots] =
    useState<TongsangShipmentSlot[]>(emptyShipmentSlots);
  const [formCaptured24k, setFormCaptured24k] = useState("");
  const [formCaptured18k, setFormCaptured18k] = useState("");
  const [formCaptured14k, setFormCaptured14k] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";

  const pureDonTotal = tongsangPureDonTotal(formPureG, formK18G, formK14G);
  const capturedDonTotal = tongsangCapturedDonTotal(
    parseTongsangCapturedDonInput(formCaptured24k),
    parseTongsangCapturedDonInput(formCaptured18k),
    parseTongsangCapturedDonInput(formCaptured14k),
  );

  const karatFormRows = useMemo(
    () =>
      (
        [
          {
            key: "24K" as const,
            g: formPureG,
            setG: setFormPureG,
            captured: formCaptured24k,
            setCaptured: setFormCaptured24k,
          },
          {
            key: "18K" as const,
            g: formK18G,
            setG: setFormK18G,
            captured: formCaptured18k,
            setCaptured: setFormCaptured18k,
          },
          {
            key: "14K" as const,
            g: formK14G,
            setG: setFormK14G,
            captured: formCaptured14k,
            setCaptured: setFormCaptured14k,
          },
        ] as const
      ).map((row) => ({
        ...row,
        don: tongsangDonFromGramInput(row.g),
        pureDon: tongsangPureDonFromGramInput(row.g, row.key),
      })),
    [
      formPureG,
      formK18G,
      formK14G,
      formCaptured24k,
      formCaptured18k,
      formCaptured14k,
    ],
  );

  const selectedBranchLabel = useMemo(() => {
    const b = branchesForShopSelect(branches).find((x) => x.id === branchId);
    return b ? displayBranchName(b.name) : "";
  }, [branches, branchId]);

  useEffect(() => {
    setProfile(bootstrap.profile);
    setBranches(bootstrap.branches);
    const shop = branchesForShopSelect(bootstrap.branches);
    if (bootstrap.profile?.role === "staff" && bootstrap.profile.branch_id) {
      setBranchId(bootstrap.profile.branch_id);
    } else if (shop.length > 0) {
      setBranchId((c) => {
        if (c && shop.some((b) => b.id === c)) return c;
        return (
          readSavedTongsangBranchId(bootstrap.branches) ??
          tongsangDefaultBranchId(bootstrap.branches)
        );
      });
    }
  }, [bootstrap]);

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
        if (!uniq.includes(selectedYear)) {
          setSelectedYear(uniq[uniq.length - 1]);
        }
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

  useEffect(() => {
    if (view !== "month") return;
    const r = monthDateRange(selectedYear, selectedMonth);
    setFromDate(r.from);
    setToDate(r.to);
  }, [selectedMonth, selectedYear, view]);

  useEffect(() => {
    if (!profile || branches.length === 0) return;
    const shop = branchesForShopSelect(branches);
    if (isAdmin) {
      if (branchId && shop.some((b) => b.id === branchId)) return;
      const next =
        readSavedTongsangBranchId(branches) ?? tongsangDefaultBranchId(branches);
      if (next) setBranchId(next);
    } else if (profile.branch_id) {
      setBranchId(profile.branch_id);
    }
  }, [profile, branches, isAdmin, branchId]);

  const setAdminBranchId = useCallback((id: string) => {
    setBranchId(id);
    try {
      localStorage.setItem(LS_BRANCH, id);
    } catch {
      // ignore
    }
  }, []);

  const loadRange = useMemo(() => {
    if (view === "yearTotal") {
      return {
        from: `${selectedYear}-01-01`,
        to: `${selectedYear}-12-31`,
      };
    }
    return { from: fromDate, to: toDate };
  }, [view, selectedYear, fromDate, toDate]);

  const load = useCallback(async () => {
    if (!branchId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: le } = await supabase
      .from("tongsang_daily_entries")
      .select("*")
      .eq("branch_id", branchId)
      .gte("entry_date", loadRange.from)
      .lte("entry_date", loadRange.to)
      .order("entry_date", { ascending: false });
    setLoading(false);
    if (le) {
      if (isMissingTongsangTable(le)) {
        setTableMissing(true);
        setEntries([]);
        return;
      }
      setError(le.message);
      setEntries([]);
      return;
    }
    setTableMissing(false);
    setEntries((data ?? []) as TongsangDailyEntry[]);
  }, [supabase, branchId, loadRange.from, loadRange.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const yearSummary = useMemo(() => {
    if (view !== "yearTotal") return null;
    const byMonth: Record<
      number,
      { days: number; pureG: number; k18G: number; k14G: number }
    > = {};
    for (let m = 1; m <= 12; m++) {
      byMonth[m] = { days: 0, pureG: 0, k18G: 0, k14G: 0 };
    }
    for (const row of entries) {
      const m = Number(String(row.entry_date).slice(5, 7));
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;
      byMonth[m].days += 1;
      byMonth[m].pureG += Number(row.pure_gold_g ?? 0);
      byMonth[m].k18G += Number(row.gold_18k_g ?? 0);
      byMonth[m].k14G += Number(row.gold_14k_g ?? 0);
    }
    const total = Object.values(byMonth).reduce(
      (a, v) => ({
        days: a.days + v.days,
        pureG: a.pureG + v.pureG,
        k18G: a.k18G + v.k18G,
        k14G: a.k14G + v.k14G,
      }),
      { days: 0, pureG: 0, k18G: 0, k14G: 0 },
    );
    return { byMonth, total };
  }, [entries, view]);

  function addYearFolder(y: number) {
    if (!Number.isFinite(y) || y < 2000 || y > 2100) return;
    setYearFolders((prev) => Array.from(new Set([...prev, y])).sort((a, b) => a - b));
    setSelectedYear(y);
    setView("month");
  }

  function resetFormForNewDay(date?: string) {
    setEditingId(null);
    setFormDate(date ?? todayYmdSeoul());
    setFormPureG("");
    setFormK18G("");
    setFormK14G("");
    setFormShipmentSlots(emptyShipmentSlots());
    setFormCaptured24k("");
    setFormCaptured18k("");
    setFormCaptured14k("");
  }

  function capturedDonToFormString(
    row: TongsangDailyEntry,
    karat: TongsangKaratRow,
  ): string {
    return donToInputString(tongsangCapturedDonForKarat(row, karat));
  }

  function loadRowIntoForm(row: TongsangDailyEntry) {
    setEditingId(row.id);
    setFormDate(row.entry_date);
    setFormPureG(gramToInputString(row.pure_gold_g));
    setFormK18G(gramToInputString(row.gold_18k_g));
    setFormK14G(gramToInputString(row.gold_14k_g));
    setFormCaptured24k(capturedDonToFormString(row, "24K"));
    setFormCaptured18k(capturedDonToFormString(row, "18K"));
    setFormCaptured14k(capturedDonToFormString(row, "14K"));
    setFormShipmentSlots([
      decodeTongsangShipmentSlot(row.shipment_item_1),
      decodeTongsangShipmentSlot(row.shipment_item_2),
      decodeTongsangShipmentSlot(row.shipment_item_3),
      decodeTongsangShipmentSlot(row.shipment_item_4),
      decodeTongsangShipmentSlot(row.shipment_item_5),
    ]);
  }

  /** 날짜·매장 기준 저장된 일마감 행을 폼에 반영 (없으면 빈 폼) */
  const applyFormDate = useCallback(
    async (nextDate: string) => {
      setFormDate(nextDate);
      if (!branchId) {
        resetFormForNewDay(nextDate);
        return;
      }

      const localMatch = entries.find(
        (row) => row.entry_date === nextDate && row.branch_id === branchId,
      );
      if (localMatch) {
        loadRowIntoForm(localMatch);
        return;
      }

      const { data, error: fe } = await supabase
        .from("tongsang_daily_entries")
        .select("*")
        .eq("branch_id", branchId)
        .eq("entry_date", nextDate)
        .maybeSingle();

      if (fe) {
        if (!isMissingTongsangTable(fe)) setError(fe.message);
        resetFormForNewDay(nextDate);
        return;
      }
      if (data) loadRowIntoForm(data as TongsangDailyEntry);
      else resetFormForNewDay(nextDate);
    },
    [branchId, entries, supabase],
  );

  useEffect(() => {
    if (!formDate || !branchId || loading) return;
    const match = entries.find(
      (row) => row.entry_date === formDate && row.branch_id === branchId,
    );
    if (match && editingId !== match.id) loadRowIntoForm(match);
  }, [entries, loading, branchId, formDate, editingId]);

  useEffect(() => {
    if (!formDate || !branchId) return;
    void applyFormDate(formDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function handleSave() {
    if (!branchId) {
      setError("매장을 선택하세요.");
      return;
    }
    if (!formDate.trim()) {
      setError("날짜를 입력하세요.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("로그인이 필요합니다.");
      return;
    }

    const payload = {
      branch_id: branchId,
      entry_date: formDate,
      pure_gold_g: parseTongsangGramInput(formPureG),
      gold_18k_g: parseTongsangGramInput(formK18G),
      gold_14k_g: parseTongsangGramInput(formK14G),
      captured_don_24k: parseTongsangCapturedDonInput(formCaptured24k),
      captured_don_18k: parseTongsangCapturedDonInput(formCaptured18k),
      captured_don_14k: parseTongsangCapturedDonInput(formCaptured14k),
      shipment_item_1: encodeTongsangShipmentSlot(
        formShipmentSlots[0]?.name ?? "",
        formShipmentSlots[0]?.detail ?? "",
      ),
      shipment_item_2: encodeTongsangShipmentSlot(
        formShipmentSlots[1]?.name ?? "",
        formShipmentSlots[1]?.detail ?? "",
      ),
      shipment_item_3: encodeTongsangShipmentSlot(
        formShipmentSlots[2]?.name ?? "",
        formShipmentSlots[2]?.detail ?? "",
      ),
      shipment_item_4: encodeTongsangShipmentSlot(
        formShipmentSlots[3]?.name ?? "",
        formShipmentSlots[3]?.detail ?? "",
      ),
      shipment_item_5: encodeTongsangShipmentSlot(
        formShipmentSlots[4]?.name ?? "",
        formShipmentSlots[4]?.detail ?? "",
      ),
      updated_by: user.id,
      ...(editingId ? {} : { created_by: user.id }),
    };

    setSaving(true);
    setError(null);
    const { error: se } = await supabase
      .from("tongsang_daily_entries")
      .upsert(payload, { onConflict: "branch_id,entry_date" });
    setSaving(false);
    if (se) {
      if (isMissingTongsangTable(se)) {
        setTableMissing(true);
        setError(TONGSANG_SETUP_HINT);
      } else {
        setError(se.message);
      }
      return;
    }
    setMsg(`${formDate} 통상 기록을 저장했습니다.`);
    if (typeof window !== "undefined") {
      window.setTimeout(() => setMsg(null), 3000);
    }
    await load();
    const { data: savedRow } = await supabase
      .from("tongsang_daily_entries")
      .select("*")
      .eq("branch_id", branchId)
      .eq("entry_date", formDate)
      .maybeSingle();
    if (savedRow) loadRowIntoForm(savedRow as TongsangDailyEntry);
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!window.confirm(`${formDate} 통상 기록을 삭제할까요?`)) return;
    setDeleting(true);
    setError(null);
    const { error: de } = await supabase
      .from("tongsang_daily_entries")
      .delete()
      .eq("id", editingId);
    setDeleting(false);
    if (de) {
      setError(de.message);
      return;
    }
    setMsg("삭제했습니다.");
    resetFormForNewDay(formDate);
    await load();
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-3 sm:px-4 lg:px-5">
      <RegistrationPageHeader
        title="통상"
        description={
          <HelpTooltip label="통상 도움말" trigger="text">
            종로 통상은 <span className="font-medium">하루 1건</span>씩
            기록합니다. 중량(g) 입력 시 돈수는{" "}
            <span className="tabular-nums">g ÷ 3.75</span> (소수 둘째 자리)로
            자동 계산됩니다.
          </HelpTooltip>
        }
      />

      <section className="tongsang-period-panel flex min-h-0 min-w-0 flex-col">
        <div>
          <p className="tongsang-period-section-label mb-1 block text-left">년도</p>
          <div className="tongsang-pill-row mt-2">
            {yearFolders.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => {
                  setSelectedYear(y);
                  setView("month");
                }}
                className={
                  selectedYear === y
                    ? "tongsang-pill tongsang-pill-active"
                    : "tongsang-pill tongsang-pill-inactive"
                }
              >
                {formatLedgerYearLabel(y)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const input = prompt("추가할 연도(예: 2028)");
                if (!input) return;
                addYearFolder(Number(String(input).trim()));
              }}
              className="tongsang-pill-ghost shrink-0"
            >
              + 연도 추가
            </button>
          </div>

          <p className="tongsang-period-section-label mb-1 mt-4 block text-left">
            {formatLedgerYearLabel(selectedYear)}
          </p>
          <div className="tongsang-pill-row mt-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setView("month");
                  setSelectedMonth(m);
                }}
                className={
                  view === "month" && selectedMonth === m
                    ? "tongsang-pill tongsang-pill-active"
                    : "tongsang-pill tongsang-pill-inactive"
                }
              >
                {m}월
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setFromDate(`${selectedYear}-01-01`);
                setToDate(`${selectedYear}-12-31`);
                setView("yearTotal");
              }}
              className={
                view === "yearTotal"
                  ? "tongsang-pill tongsang-pill-active"
                  : "tongsang-pill tongsang-pill-inactive"
              }
            >
              연합계
            </button>
          </div>
        </div>
      </section>

      {tableMissing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          통상 기록 테이블이 없습니다. {TONGSANG_SETUP_HINT}
        </div>
      ) : null}
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

      {view === "yearTotal" && yearSummary ? (
        <section className="purchase-ledger-work-card p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {formatLedgerYearLabel(selectedYear)} 연합계
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-3 py-3">
              <p className="text-xs font-medium text-[var(--muted)]">기록 일수</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--foreground)]">
                {yearSummary.total.days}일
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-3">
              <p className="text-xs font-medium text-[var(--muted)]">순금 합(g)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-amber-950">
                {formatTongsangGram(yearSummary.total.pureG)}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-3 py-3">
              <p className="text-xs font-medium text-[var(--muted)]">18K 합(g)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--foreground)]">
                {formatTongsangGram(yearSummary.total.k18G)}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-3 py-3">
              <p className="text-xs font-medium text-[var(--muted)]">14K 합(g)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--foreground)]">
                {formatTongsangGram(yearSummary.total.k14G)}
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[36rem] w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs font-medium text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2 text-center">월</th>
                  <th className="px-2 py-2 text-center">기록 일수</th>
                  <th className="px-2 py-2 text-center">순금(g)</th>
                  <th className="px-2 py-2 text-center">18K(g)</th>
                  <th className="px-2 py-2 text-center">14K(g)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <tr key={m}>
                    <td className="px-2 py-2 text-center">{m}월</td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      {yearSummary.byMonth[m].days}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      {formatTongsangGram(yearSummary.byMonth[m].pureG)}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      {formatTongsangGram(yearSummary.byMonth[m].k18G)}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">
                      {formatTongsangGram(yearSummary.byMonth[m].k14G)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {view === "month" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start lg:gap-8">
          <section className="tongsang-work-card tongsang-work-card--compact min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h2 className="tongsang-work-card-title">일 마감 장부</h2>
              <p className="tongsang-work-card-sub">
                {editingId ? "수정 중" : "작성"} · 같은 날짜 1건
                <span className="text-[var(--muted)]"> · </span>
                <span className="tabular-nums">
                  {formatTongsangEntryDateDisplay(formDate)}
                </span>
              </p>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="tongsang-field-label" htmlFor="tongsang-date">
                  날짜
                </label>
                <input
                  id="tongsang-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => void applyFormDate(e.target.value)}
                  className="tongsang-field-input tabular-nums"
                />
              </div>
              <div>
                <label className="tongsang-field-label" htmlFor="tongsang-branch">
                  매장
                </label>
                {isAdmin ? (
                  <select
                    id="tongsang-branch"
                    value={branchId}
                    onChange={(e) => setAdminBranchId(e.target.value)}
                    className="tongsang-field-input"
                  >
                    {branchSelectRowsForShop(branches).map((b) => (
                      <option key={b.id} value={b.id}>
                        {displayBranchName(b.label)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p
                    id="tongsang-branch"
                    className="tongsang-field-input flex items-center"
                  >
                    동네금빵 {selectedBranchLabel || "—"}
                  </p>
                )}
              </div>
            </div>

            <div className="tongsang-karat-block mt-3">
              <div className="tongsang-karat-block-head">
                <span />
                <span>중량(g)</span>
                <span>돈수</span>
                <span>순금돈</span>
                <span>잡힌돈</span>
              </div>
              {karatFormRows.map((row) => (
                <div key={row.key} className="tongsang-karat-block-row">
                  <span className="tongsang-karat-block-badge">{row.key}</span>
                  <input
                    value={row.g}
                    onChange={(e) => row.setG(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="tongsang-field-input tabular-nums !mt-0 h-8 !text-xs"
                  />
                  <p className="tongsang-karat-block-num">
                    {formatTongsangDon(row.don)}
                  </p>
                  <p className="tongsang-karat-block-num">
                    {formatTongsangDon(row.pureDon)}
                  </p>
                  <input
                    value={row.captured}
                    onChange={(e) => row.setCaptured(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="tongsang-field-input tabular-nums font-semibold !mt-0 h-8 !text-xs"
                  />
                </div>
              ))}
              <div className="tongsang-karat-block-total">
                <div>
                  <span className="tongsang-field-label">순금총합</span>
                  <p className="tongsang-karat-num tongsang-karat-num-accent">
                    {formatTongsangDon(pureDonTotal)}
                  </p>
                </div>
                <div>
                  <span className="tongsang-field-label">잡힌돈수 합</span>
                  <p className="tongsang-karat-num tongsang-karat-num-accent">
                    {formatTongsangDon(capturedDonTotal)}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <p className="tongsang-period-section-label mb-2 text-xs">거래처·제품</p>
              <div className="tongsang-shipment-block">
                <div className="tongsang-shipment-block-head">
                  <span />
                  <span>거래처</span>
                  <span>건수·비고</span>
                </div>
                {formShipmentSlots.map((slot, i) => (
                  <div key={i} className="tongsang-shipment-block-row">
                    <span className="tongsang-shipment-slot-num">{i + 1}</span>
                    <input
                      value={slot.name}
                      onChange={(e) => {
                        const next = [...formShipmentSlots];
                        next[i] = { ...next[i], name: e.target.value };
                        setFormShipmentSlots(next);
                      }}
                      className="tongsang-field-input tabular-nums !mt-0 h-8 !text-xs"
                    />
                    <input
                      value={slot.detail}
                      onChange={(e) => {
                        const next = [...formShipmentSlots];
                        next[i] = { ...next[i], detail: e.target.value };
                        setFormShipmentSlots(next);
                      }}
                      className="tongsang-field-input tabular-nums !mt-0 h-8 !text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>

            <p className="tongsang-guide-text mt-2">
              돈수 = g÷3.75 · 순금돈수 = 돈수×함량(24K 100% · 18K 74% · 14K 57.5%)
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || deleting || tableMissing}
                onClick={() => void handleSave()}
                className="tongsang-pill tongsang-pill-active px-4 py-2 text-sm disabled:opacity-50"
              >
                {saving ? "저장 중…" : "저장"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  disabled={saving || deleting}
                  onClick={() => void handleDelete()}
                  className="tongsang-btn-muted text-amount-out disabled:opacity-50"
                >
                  {deleting ? "삭제 중…" : "삭제"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={saving || deleting}
                onClick={() => resetFormForNewDay()}
                className="tongsang-btn-muted disabled:opacity-50"
              >
                입력 초기화
              </button>
            </div>
          </section>

          <section className="tongsang-work-card flex min-h-0 min-w-0 flex-col">
            <div>
              <h2 className="tongsang-work-card-title">
                {formatLedgerYearLabel(selectedYear)} {selectedMonth}월 일별 기록
              </h2>
              <p className="tongsang-work-card-sub">
                {loading ? "불러오는 중…" : (
                  <>
                    {selectedBranchLabel ? `${selectedBranchLabel} · ` : null}
                    기록 {entries.length}일 · 카드 클릭 시 왼쪽에서 수정
                  </>
                )}
              </p>
            </div>

            <div className="tongsang-entry-list mt-5 min-h-0 flex-1 max-h-[42rem]">
              {loading ? (
                <p className="py-12 text-center text-sm text-[#8B95A1]">
                  불러오는 중…
                </p>
              ) : entries.length === 0 ? (
                <p className="py-12 text-center text-sm leading-relaxed text-[#8B95A1]">
                  이 달 기록이 없습니다.
                  <br />
                  왼쪽에서 작성하세요.
                </p>
              ) : (
                entries.map((row) => {
                  const selected =
                    editingId === row.id || formDate === row.entry_date;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => loadRowIntoForm(row)}
                      className={`tongsang-entry-card ${
                        selected ? "tongsang-entry-card-selected" : ""
                      }`}
                    >
                      <div className="tongsang-entry-card-row">
                        <p className="tongsang-entry-date">
                          {formatTongsangEntryDateDisplay(row.entry_date)}
                        </p>
                        <div className="tongsang-entry-card-cols">
                          <div className="min-w-0">
                            <p className="tongsang-entry-col-label mb-1">
                              순금총합
                            </p>
                            <TongsangKaratDonLines
                              alignLeft
                              lines={tongsangPureDonLinesFromEntry(row)}
                              totalDon={tongsangPureDonTotal(
                                gramToInputString(row.pure_gold_g),
                                gramToInputString(row.gold_18k_g),
                                gramToInputString(row.gold_14k_g),
                              )}
                              emphasize
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="tongsang-entry-col-label mb-1">
                              잡힌돈수
                            </p>
                            <TongsangKaratDonLines
                              alignLeft
                              lines={tongsangCapturedDonLinesFromEntry(row)}
                              totalDon={tongsangCapturedDonTotal(
                                tongsangCapturedDonForKarat(row, "24K"),
                                tongsangCapturedDonForKarat(row, "18K"),
                                tongsangCapturedDonForKarat(row, "14K"),
                              )}
                            />
                          </div>
                          <div className="min-w-0 text-left">
                            <p className="tongsang-entry-col-label mb-1">
                              보낸 제품
                            </p>
                            <p className="tongsang-entry-shipment-text">
                              {tongsangShipmentSummary(row) || "—"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

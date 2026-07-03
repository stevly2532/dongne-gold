"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatKRW,
  formatWonInputDisplay,
  parseWonDigitsToNumber,
  purchaseLedgerDateCellParts,
  sanitizeWonInputDigits,
  seoulYmdFromIso,
  todayYmdSeoul,
  formatLedgerYearLabel,
} from "@/lib/format";
import { firstShopSelectableBranchId } from "@/lib/branchLabels";
import {
  formatMobileInputDisplay,
  normalizeKoreanMobilePhone,
} from "@/lib/koreanPhone";
import { matchesLedgerCustomerSearch } from "@/lib/ledgerCustomerSearch";
import { LedgerSelectionSumBar } from "@/components/LedgerSelectionSumBar";
import { AsLedgerEditDialog } from "@/components/AsLedgerEditDialog";
import { HelpTooltip } from "@/components/HelpTooltip";
import { RegistrationPageHeader } from "@/components/RegistrationPageHeader";
import { buildArrivalSmsBody, openArrivalSms } from "@/lib/arrivalSms";
import type { AsLedgerRow, Branch, Profile } from "@/types/db";

/** Ctrl/⌘+C 복사 시 첫 줄 헤더(표 열 순서와 동일, 삭제 버튼 열 제외) */
const AS_LEDGER_CLIPBOARD_HEADERS = [
  "날짜",
  "이름",
  "전화번호",
  "제품명",
  "수리내용",
  "비용",
  "결제",
  "입출고",
  "삭제",
] as const;

function monthDateRange(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const end = new Date(year, month, 0);
  const to = `${year}-${pad(month)}-${pad(end.getDate())}`;
  return { from, to };
}

function todayRangeLocal() {
  const ymd = todayYmdSeoul();
  return { from: ymd, to: ymd };
}

function miniCompleteClass(done: boolean): string {
  return done
    ? "border-emerald-400 bg-emerald-50 text-emerald-900 focus:border-emerald-500 focus:ring-emerald-400/35"
    : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:border-amber-500 focus:ring-amber-400/40";
}

function isDoneMark(raw: string | null | undefined): boolean {
  const t = raw?.trim();
  return t === "완" || t === "완료";
}

function normalizeDoneMark(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t === "완") return "완료";
  return t;
}

/** 비용 미입력·0원이면 받을 돈 없음 → 결제 완 */
function isAsNoChargeCostDigits(costDigits: string): boolean {
  const costN = parseWonDigitsToNumber(costDigits);
  return costN == null || costN === 0;
}

/** 비용 미입력·0원이면 결제 칸 표시·저장 시 완 */
function paidNoteAfterCostDigits(
  costDigits: string,
  currentPaidNote: string,
): string {
  if (isAsNoChargeCostDigits(costDigits)) return "완";
  if (isDoneMark(currentPaidNote)) return "";
  return currentPaidNote;
}

function asPaidNoteFormDisplay(
  costDigits: string,
  paidNote: string,
): string {
  if (isAsNoChargeCostDigits(costDigits)) return "완";
  return paidNote;
}

/**
 * AS 등록 추가 행 — 한 손님이 2개 이상 수리를 맡길 때 명세를 행별로 입력.
 * 이름·전화번호는 거래 공통(첫 행)이라 추가 행 타입에는 포함되지 않는다.
 */
type ExtraRepairRow = {
  rid: string;
  product_name: string;
  repair_note: string;
  cost_digits: string;
  paid_note: string;
  received_note: string;
  shipped_note: string;
};

function makeExtraRepairRowId(): string {
  return `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankExtraRepairRow(): ExtraRepairRow {
  return {
    rid: makeExtraRepairRowId(),
    product_name: "",
    repair_note: "",
    cost_digits: "",
    paid_note: "",
    received_note: "",
    shipped_note: "",
  };
}

/** 단일 AS 행 insert payload 빌더 — 첫 행·추가 행 공통 사용. */
function buildAsLedgerPayload(opts: {
  ownerId: string;
  branchId: string;
  customer_name: string;
  customer_phone: string;
  product_name: string;
  repair_note: string;
  cost_digits: string;
  paid_note: string;
  received_note: string;
  shipped_note: string;
}) {
  const costN = parseWonDigitsToNumber(opts.cost_digits);
  const phoneTrim = opts.customer_phone.trim();
  const paidRaw = isAsNoChargeCostDigits(opts.cost_digits)
    ? opts.paid_note.trim() || "완"
    : opts.paid_note.trim();
  return {
    owner_id: opts.ownerId,
    branch_id: opts.branchId,
    customer_name: opts.customer_name.trim() || null,
    customer_phone: phoneTrim
      ? normalizeKoreanMobilePhone(phoneTrim).trim() || null
      : null,
    product_name: opts.product_name.trim() || null,
    repair_note: opts.repair_note.trim() || null,
    cost_won:
      costN != null && Number.isFinite(costN) && costN >= 0
        ? Math.round(costN)
        : null,
    paid_note: paidRaw ? normalizeDoneMark(paidRaw) ?? null : null,
    received_note: normalizeDoneMark(opts.received_note) ?? null,
    shipped_note: normalizeDoneMark(opts.shipped_note) ?? null,
    updated_at: new Date().toISOString(),
  };
}

export default function AsLedgerPage() {
  const supabase = useMemo(() => createClient(), []);
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const LS_YEARS = "asLedger_yearFolders";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");

  const [rows, setRows] = useState<AsLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingAsRow, setEditingAsRow] = useState<AsLedgerRow | null>(null);

  const isAdmin = profile?.role === "admin";
  const tableColSpan = isAdmin ? 10 : 9;

  /** 표에서 드래그·Ctrl+클릭으로 셀을 골랐을 때 Ctrl+C로 엑셀에 붙여넣을 수 있게 */
  const asLedgerClipboardCopy = useMemo(
    () => ({
      columnHeaders: AS_LEDGER_CLIPBOARD_HEADERS,
      includeHeaderRow: false,
      omitLeadingDataColumns: 0,
      /** 맨 오른쪽 수정·삭제 열은 복사 제외 */
      omitTrailingDataColumns: isAdmin ? 2 : 1,
    }),
    [isAdmin],
  );

  const effectiveBranchId = useMemo(() => {
    if (!profile) return branchId;
    return profile.role === "admin" ? branchId : profile.branch_id || "";
  }, [profile, branchId]);

  const asLedgerSumRef = useRef<HTMLDivElement>(null);

  const [newRow, setNewRow] = useState({
    customer_name: "",
    customer_phone: "",
    product_name: "",
    repair_note: "",
    cost_digits: "",
    paid_note: "",
    received_note: "",
    shipped_note: "",
  });
  /** 같은 손님(이름·전화 공통) 추가 명세 행들 */
  const [extraRepairRows, setExtraRepairRows] = useState<ExtraRepairRow[]>([]);

  const addExtraRepairRow = useCallback(() => {
    setExtraRepairRows((rs) => [...rs, blankExtraRepairRow()]);
  }, []);

  const removeExtraRepairRow = useCallback((rid: string) => {
    setExtraRepairRows((rs) => rs.filter((r) => r.rid !== rid));
  }, []);

  const updateExtraRepairRow = useCallback(
    (rid: string, patch: Partial<ExtraRepairRow>) => {
      setExtraRepairRows((rs) =>
        rs.map((r) => (r.rid === rid ? { ...r, ...patch } : r)),
      );
    },
    [],
  );
  /** 직전거래용: 같은 지점에서 `created_at`이 가장 최근인 행 중 이름·전화가 있는 고객 (표 정렬과 무관) */
  const recentCustomerFromAsRows = useMemo(() => {
    let best: AsLedgerRow | null = null;
    for (const r of rows) {
      const name = (r.customer_name ?? "").trim();
      const phone = (r.customer_phone ?? "").trim();
      if (!name && !phone) continue;
      if (
        !best ||
        new Date(r.created_at).getTime() > new Date(best.created_at).getTime()
      ) {
        best = r;
      }
    }
    if (!best) return null;
    return {
      name: (best.customer_name ?? "").trim(),
      phone: (best.customer_phone ?? "").trim(),
    };
  }, [rows]);

  const [ledgerDateSortAsc, setLedgerDateSortAsc] = useState(false);
  const [asLedgerTodayOnly, setAsLedgerTodayOnly] = useState(false);
  const [asLedgerSearch, setAsLedgerSearch] = useState("");

  const [yearFolders, setYearFolders] = useState<number[]>([
    currentYear - 1,
    currentYear,
    currentYear + 1,
  ]);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(
    () => now.getMonth() + 1,
  );
  const [view, setView] = useState<"month" | "yearTotal">("month");
  const initialMonth = useMemo(
    () => monthDateRange(currentYear, now.getMonth() + 1),
    [currentYear, now],
  );
  const [fromDate, setFromDate] = useState(initialMonth.from);
  const [toDate, setToDate] = useState(initialMonth.to);

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

  useEffect(() => {
    if (view !== "month") return;
    const r = monthDateRange(selectedYear, selectedMonth);
    setFromDate(r.from);
    setToDate(r.to);
  }, [selectedMonth, selectedYear, view]);

  const asLedgerRows = useMemo(() => {
    const ymdToday = todayYmdSeoul();
    const q = asLedgerSearch.trim();
    let list = [...rows];
    if (asLedgerTodayOnly) {
      list = list.filter((r) => seoulYmdFromIso(r.created_at) === ymdToday);
    }
    if (q.length > 0) {
      list = list.filter((r) =>
        matchesLedgerCustomerSearch(
          q,
          r.customer_name,
          r.customer_phone,
          r.product_name,
          [r.repair_note],
        ),
      );
    }
    list.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      if (ta !== tb) return ledgerDateSortAsc ? ta - tb : tb - ta;
      return a.id.localeCompare(b.id);
    });
    return list;
  }, [rows, asLedgerTodayOnly, asLedgerSearch, ledgerDateSortAsc]);

  const asPeriodSummary = useMemo(() => {
    return {
      count: rows.length,
      sum: rows.reduce((a, r) => {
        const n = r.cost_won != null ? Number(r.cost_won) : NaN;
        return a + (Number.isFinite(n) ? Math.round(n) : 0);
      }, 0),
    };
  }, [rows]);

  const asLedgerTableSum = useMemo(() => {
    return asLedgerRows.reduce((a, r) => {
      const n = r.cost_won != null ? Number(r.cost_won) : NaN;
      return a + (Number.isFinite(n) ? Math.round(n) : 0);
    }, 0);
  }, [asLedgerRows]);

  const hasPrevAsCustomer = recentCustomerFromAsRows != null;
  const [reusePrevAsCustomer, setReusePrevAsCustomer] = useState(false);

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
      setBranches([]);
      setRows([]);
      setLoading(false);
      return;
    }
    const list = (br ?? []) as Branch[];
    setBranches(list);

    const adminDefaultId = firstShopSelectableBranchId(list);
    const effId =
      (prof as Profile).role === "admin"
        ? adminDefaultId
        : (prof as Profile).branch_id || "";
    if ((prof as Profile).role === "admin") {
      setBranchId(adminDefaultId);
    } else if (!branchId) {
      setBranchId(effId);
    }

    if (!effId) {
      setRows([]);
      setLoading(false);
      return;
    }

    const fromIso = new Date(`${fromDate}T00:00:00`).toISOString();
    const toIso = new Date(`${toDate}T23:59:59.999`).toISOString();

    const { data: asData, error: ae } = await supabase
      .from("as_ledgers")
      .select("*")
      .eq("branch_id", effId)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(8000);
    if (ae) {
      setError(ae.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((asData ?? []) as AsLedgerRow[]);
    setLoading(false);
  }, [supabase, branchId, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const addAsRow = useCallback(async () => {
    setError(null);
    setMsg(null);
    if (!effectiveBranchId) {
      setError("지점을 먼저 선택하세요.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const firstPayload = buildAsLedgerPayload({
      ownerId: user.id,
      branchId: effectiveBranchId,
      customer_name: newRow.customer_name,
      customer_phone: newRow.customer_phone,
      product_name: newRow.product_name,
      repair_note: newRow.repair_note,
      cost_digits: newRow.cost_digits,
      paid_note: newRow.paid_note,
      received_note: newRow.received_note,
      shipped_note: newRow.shipped_note,
    });

    /** 추가 행은 첫 행과 동일한 손님 이름·전화로 묶어 저장 (한 사람의 여러 수리 명세). */
    const sharedName = firstPayload.customer_name;
    const sharedPhone = firstPayload.customer_phone;
    const extraPayloads = extraRepairRows.map((r) => {
      const built = buildAsLedgerPayload({
        ownerId: user.id,
        branchId: effectiveBranchId,
        customer_name: "",
        customer_phone: "",
        product_name: r.product_name,
        repair_note: r.repair_note,
        cost_digits: r.cost_digits,
        paid_note: r.paid_note,
        received_note: r.received_note,
        shipped_note: r.shipped_note,
      });
      return { ...built, customer_name: sharedName, customer_phone: sharedPhone };
    });

    const payloads = [firstPayload, ...extraPayloads];

    setBusy(true);
    const { error: ie } = await supabase.from("as_ledgers").insert(payloads);
    setBusy(false);
    if (ie) {
      setError(ie.message);
      return;
    }
    const savedName = newRow.customer_name.trim();
    const savedPhone = newRow.customer_phone.trim();
    const empty = {
      customer_name: "",
      customer_phone: "",
      product_name: "",
      repair_note: "",
      cost_digits: "",
      paid_note: "",
      received_note: "",
      shipped_note: "",
    };
    setNewRow(
      reusePrevAsCustomer && (savedName || savedPhone)
        ? {
            ...empty,
            customer_name: savedName,
            customer_phone: savedPhone
              ? formatMobileInputDisplay(savedPhone)
              : "",
          }
        : empty,
    );
    setExtraRepairRows([]);
    setMsg(
      payloads.length > 1
        ? `AS 장부에 ${payloads.length}건 추가했습니다.`
        : "AS 장부에 추가했습니다.",
    );
    await load();
  }, [
    supabase,
    effectiveBranchId,
    newRow,
    extraRepairRows,
    load,
    reusePrevAsCustomer,
  ]);

  const updateRow = useCallback(
    async (id: string, patch: Partial<AsLedgerRow>) => {
      setError(null);
      const updated_at = new Date().toISOString();
      const { error: ue } = await supabase
        .from("as_ledgers")
        .update({ ...patch, updated_at })
        .eq("id", id);
      if (ue) {
        setError(ue.message);
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch, updated_at } : r)),
      );
    },
    [supabase],
  );

  /**
   * 입고 칸 저장. 문자는 자동 발송하지 않는다 — '문자' 버튼으로 직접 보내야
   * 발송 여부(버튼 색)를 구분할 수 있다.
   */
  const saveReceivedNote = useCallback(
    async (row: AsLedgerRow, raw: string) => {
      const mark = normalizeDoneMark(raw);
      await updateRow(row.id, { received_note: mark });
    },
    [updateRow],
  );

  /** 입고 안내 문자 발송 성공 시 호출 — 발송 시각을 저장하고 표에 색으로 표시. */
  const markArrivalSmsSent = useCallback(
    async (rowId: string) => {
      const sentAt = new Date().toISOString();
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, arrival_sms_sent_at: sentAt } : r,
        ),
      );
      // 컬럼 미존재 등으로 실패해도 발송은 이미 성공이므로 에러를 띄우지 않는다.
      await supabase
        .from("as_ledgers")
        .update({ arrival_sms_sent_at: sentAt })
        .eq("id", rowId);
    },
    [supabase],
  );

  const removeRow = useCallback(
    async (id: string) => {
      if (!confirm("이 AS 기록을 삭제할까요?")) return;
      setError(null);
      const { error: de } = await supabase.from("as_ledgers").delete().eq("id", id);
      if (de) {
        setError(de.message);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      setMsg("삭제했습니다.");
    },
    [supabase],
  );

  const asField = "flex min-w-0 flex-col gap-1";
  const asLabel = "toss-form-label text-center";
  const asInput =
    "toss-input h-9 w-full px-2 text-sm leading-none text-center";
  const asInputNum = `${asInput} tabular-nums text-right`;
  const asMiniInput = (done: boolean) =>
    `toss-input h-9 w-full px-1 text-sm text-center outline-none focus:ring-2 ${miniCompleteClass(done)}`;
  const asIoBtnBase =
    "shrink-0 rounded border px-1 py-1 text-center text-[11px] font-semibold leading-none outline-none transition-colors";
  const asIoToggleBtn = (done: boolean, tone: "sky" | "emerald") =>
    `${asIoBtnBase} min-w-[1.625rem] ${
      done
        ? tone === "sky"
          ? "border-sky-400 bg-sky-100 text-sky-950 hover:bg-sky-200"
          : "border-emerald-400 bg-emerald-100 text-emerald-950 hover:bg-emerald-200"
        : tone === "sky"
          ? "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
          : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
    }`;
  const asIoSmsBtn = (smsSent: boolean, enabled: boolean) =>
    `${asIoBtnBase} min-w-[2.125rem] ${
      !enabled
        ? "cursor-not-allowed border-[var(--border)] bg-[var(--card)] text-[var(--muted)] opacity-40"
        : smsSent
          ? "border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200"
          : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
    }`;
  const asRowSidePad = "lg:pr-9";
  const asFormGridCols =
    "1.1fr 1.4fr 1.1fr 2.2fr 1fr 0.65fr 0.65fr 0.65fr";

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-3 sm:px-4 lg:px-5">
      <RegistrationPageHeader
        title="AS 장부"
        description={
          <HelpTooltip label="AS 장부 도움말" trigger="text">
            AS(수리) 맡기고 간 손님 기록을 정리합니다.{" "}
            <span className="font-medium">월·연</span>을 고르면 등록일 기준으로 그
            기간만 불러옵니다.{" "}
            <span className="font-medium">결제</span>·입고·출고는 버튼 클릭으로
            완료 표시. 비용 미입력·0원은 결제 <span className="font-medium">완</span> 자동.
            입고 후 문자로 안내 발송. 같은 손님 수리가 여러 건이면{" "}
            <span className="font-medium">+ 줄추가</span>로 명세를 더 등록합니다.
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
                const n = Number(String(input).trim());
                addYearFolder(n);
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
                setView("yearTotal");
                setFromDate(`${selectedYear}-01-01`);
                setToDate(`${selectedYear}-12-31`);
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

      {error ? (
        <div className="toss-alert-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          {msg}
        </div>
      ) : null}

      <section className="relative flex min-h-0 min-w-0 flex-col purchase-ledger-work-card p-4 lg:p-5">
        <div className="w-full space-y-2 px-1 py-1 lg:px-2">
        <div
          className={`relative hidden ${asRowSidePad} lg:block`}
        >
        <div
          className="grid gap-2 text-center text-xs font-semibold leading-tight text-[var(--foreground)]"
          style={{ gridTemplateColumns: asFormGridCols }}
        >
          <span className="truncate">이름</span>
          <span className="truncate">전화번호</span>
          <span className="truncate">제품명</span>
          <span className="truncate">수리내용</span>
          <span className="truncate">비용(원)</span>
          <span className="truncate">결제</span>
          <span className="truncate">입고</span>
          <span className="truncate">출고</span>
        </div>
        </div>

        <div className={`relative ${asRowSidePad}`}>
          <div
            className="grid items-end gap-2"
            style={{ gridTemplateColumns: asFormGridCols }}
          >
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>이름</label>
              <input
                value={newRow.customer_name}
                onChange={(e) =>
                  setNewRow((p) => ({ ...p, customer_name: e.target.value }))
                }
                className={asInput}
                placeholder="홍길동"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>전화번호</label>
              <input
                value={newRow.customer_phone}
                onChange={(e) =>
                  setNewRow((p) => ({
                    ...p,
                    customer_phone: formatMobileInputDisplay(e.target.value),
                  }))
                }
                className={`${asInput} tabular-nums`}
                placeholder="010-1234-5678"
                inputMode="tel"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>제품명</label>
              <input
                value={newRow.product_name}
                onChange={(e) =>
                  setNewRow((p) => ({ ...p, product_name: e.target.value }))
                }
                className={asInput}
                placeholder="반지/목걸이…"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>수리내용</label>
              <input
                value={newRow.repair_note}
                onChange={(e) =>
                  setNewRow((p) => ({ ...p, repair_note: e.target.value }))
                }
                className={asInput}
                placeholder="줄수리/폴리싱/잠금…"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>비용</label>
              <input
                value={formatWonInputDisplay(newRow.cost_digits)}
                onChange={(e) => {
                  const cost_digits = sanitizeWonInputDigits(e.target.value);
                  setNewRow((p) => ({
                    ...p,
                    cost_digits,
                    paid_note: paidNoteAfterCostDigits(cost_digits, p.paid_note),
                  }));
                }}
                inputMode="numeric"
                className={asInputNum}
                placeholder="0"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>결제</label>
              <input
                value={asPaidNoteFormDisplay(newRow.cost_digits, newRow.paid_note)}
                onChange={(e) => {
                  if (isAsNoChargeCostDigits(newRow.cost_digits)) return;
                  setNewRow((p) => ({ ...p, paid_note: e.target.value }));
                }}
                maxLength={2}
                className={asMiniInput(
                  isDoneMark(
                    asPaidNoteFormDisplay(newRow.cost_digits, newRow.paid_note),
                  ),
                )}
                placeholder="완"
                readOnly={isAsNoChargeCostDigits(newRow.cost_digits)}
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>입고</label>
              <input
                value={newRow.received_note}
                onChange={(e) =>
                  setNewRow((p) => ({ ...p, received_note: e.target.value }))
                }
                maxLength={2}
                className={asMiniInput(isDoneMark(newRow.received_note))}
                placeholder="완"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>출고</label>
              <input
                value={newRow.shipped_note}
                onChange={(e) =>
                  setNewRow((p) => ({ ...p, shipped_note: e.target.value }))
                }
                maxLength={2}
                className={asMiniInput(isDoneMark(newRow.shipped_note))}
                placeholder="완"
              />
            </div>
          </div>
        </div>

        {/* 추가 행 — 첫 행과 동일 그리드·입력 (이름·전화는 거래 공통) */}
        {extraRepairRows.map((r) => (
          <div key={r.rid} className={`relative ${asRowSidePad}`}>
          <div
            className="grid items-end gap-2"
            style={{ gridTemplateColumns: asFormGridCols }}
          >
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>이름</label>
              <input
                value={newRow.customer_name}
                onChange={(e) =>
                  setNewRow((p) => ({ ...p, customer_name: e.target.value }))
                }
                className={asInput}
                placeholder="홍길동"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>전화번호</label>
              <input
                value={newRow.customer_phone}
                onChange={(e) =>
                  setNewRow((p) => ({
                    ...p,
                    customer_phone: formatMobileInputDisplay(e.target.value),
                  }))
                }
                className={`${asInput} tabular-nums`}
                placeholder="010-1234-5678"
                inputMode="tel"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>제품명</label>
              <input
                value={r.product_name}
                onChange={(e) =>
                  updateExtraRepairRow(r.rid, { product_name: e.target.value })
                }
                className={asInput}
                placeholder="반지/목걸이…"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>수리내용</label>
              <input
                value={r.repair_note}
                onChange={(e) =>
                  updateExtraRepairRow(r.rid, { repair_note: e.target.value })
                }
                className={asInput}
                placeholder="줄수리/폴리싱/잠금…"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>비용</label>
              <input
                value={formatWonInputDisplay(r.cost_digits)}
                onChange={(e) => {
                  const cost_digits = sanitizeWonInputDigits(e.target.value);
                  updateExtraRepairRow(r.rid, {
                    cost_digits,
                    paid_note: paidNoteAfterCostDigits(cost_digits, r.paid_note),
                  });
                }}
                inputMode="numeric"
                className={asInputNum}
                placeholder="0"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>결제</label>
              <input
                value={asPaidNoteFormDisplay(r.cost_digits, r.paid_note)}
                onChange={(e) => {
                  if (isAsNoChargeCostDigits(r.cost_digits)) return;
                  updateExtraRepairRow(r.rid, { paid_note: e.target.value });
                }}
                maxLength={2}
                className={asMiniInput(
                  isDoneMark(
                    asPaidNoteFormDisplay(r.cost_digits, r.paid_note),
                  ),
                )}
                placeholder="완"
                readOnly={isAsNoChargeCostDigits(r.cost_digits)}
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>입고</label>
              <input
                value={r.received_note}
                onChange={(e) =>
                  updateExtraRepairRow(r.rid, { received_note: e.target.value })
                }
                maxLength={2}
                className={asMiniInput(isDoneMark(r.received_note))}
                placeholder="완"
              />
            </div>
            <div className={`${asField} lg:gap-0`}>
              <label className={`${asLabel} lg:hidden`}>출고</label>
              <input
                value={r.shipped_note}
                onChange={(e) =>
                  updateExtraRepairRow(r.rid, { shipped_note: e.target.value })
                }
                maxLength={2}
                className={asMiniInput(isDoneMark(r.shipped_note))}
                placeholder="완"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeExtraRepairRow(r.rid)}
            className="absolute right-0 top-0 flex h-9 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
            title="이 명세 삭제"
            aria-label="추가 행 삭제"
          >
            ×
          </button>
          </div>
        ))}

        </div>

        <div className="flex w-full flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <label
              className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]"
              title={
                hasPrevAsCustomer
                  ? "이 지점에서 등록 시각이 가장 최근인 고객명·전화번호를 자동 입력합니다"
                  : "같은 지점 AS 기록이 한 건 이상 있어야 합니다"
              }
            >
              <input
                type="checkbox"
                checked={reusePrevAsCustomer}
                disabled={!hasPrevAsCustomer}
                onChange={(e) => {
                  const c = e.target.checked;
                  setReusePrevAsCustomer(c);
                  if (!c) {
                    setNewRow((p) => ({
                      ...p,
                      customer_name: "",
                      customer_phone: "",
                    }));
                    return;
                  }
                  if (recentCustomerFromAsRows) {
                    const s = recentCustomerFromAsRows;
                    setNewRow((p) => ({
                      ...p,
                      customer_name: s.name,
                      customer_phone: s.phone
                        ? formatMobileInputDisplay(s.phone)
                        : "",
                    }));
                  }
                }}
                className="rounded border-[var(--border)] text-amber-700 focus:ring-amber-500 disabled:opacity-40"
              />
              직전거래
            </label>
            <button
              type="button"
              onClick={addExtraRepairRow}
              disabled={busy}
              className="toss-btn-secondary toss-btn-sm shrink-0 disabled:opacity-50"
              title="같은 손님의 다른 수리 명세 추가"
            >
              + 줄추가
            </button>
            {extraRepairRows.length > 0 ? (
              <span className="text-[11px] font-medium text-[var(--muted)]">
                총 {extraRepairRows.length + 1}건
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void addAsRow()}
            className="toss-btn-primary toss-btn-md shrink-0 tracking-wide disabled:opacity-50"
          >
            {busy
              ? "추가 중…"
              : extraRepairRows.length > 0
                ? `등록 (${extraRepairRows.length + 1}건)`
                : "등록"}
          </button>
        </div>
      </section>

      <section className="flex min-h-[50vh] w-full flex-col overflow-hidden purchase-ledger-work-card p-4 lg:min-h-[calc(100dvh-13rem)]">
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[var(--border)] pb-2.5">
          <h2 className="text-base font-semibold tracking-tight text-[var(--foreground)]">
            AS 내역
          </h2>
          <span className="text-[11px] font-medium text-[var(--muted)]">·</span>
          <span className="text-[11px] font-medium text-[var(--muted)]">등록</span>
          <button
            type="button"
            onClick={() => setLedgerDateSortAsc(true)}
            className={`rounded-md px-2.5 py-1 text-xs leading-snug ${
              ledgerDateSortAsc ? "toss-filter-active" : "toss-filter-inactive"
            }`}
          >
            오름차순
          </button>
          <button
            type="button"
            onClick={() => setLedgerDateSortAsc(false)}
            className={`rounded-md px-2.5 py-1 text-xs leading-snug ${
              !ledgerDateSortAsc ? "toss-filter-active" : "toss-filter-inactive"
            }`}
          >
            내림차순
          </button>
          <button
            type="button"
            onClick={() => setAsLedgerTodayOnly((v) => !v)}
            className={`rounded-md px-2.5 py-1 text-xs leading-snug ${
              asLedgerTodayOnly ? "toss-filter-amber" : "toss-filter-inactive"
            }`}
          >
            오늘만
          </button>
          <div className="relative shrink-0">
            <input
              type="search"
              value={asLedgerSearch}
              onChange={(e) => setAsLedgerSearch(e.target.value)}
              placeholder="이름·전화·제품·수리 (검색)"
              aria-label="AS 내역 이름·전화번호·제품명·수리내용 검색"
              className="h-8 w-[12rem] rounded-md border border-[var(--border)] bg-[var(--card)] pl-2.5 pr-7 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
            {asLedgerSearch ? (
              <button
                type="button"
                onClick={() => setAsLedgerSearch("")}
                aria-label="검색어 지우기"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-xs leading-none text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                ✕
              </button>
            ) : null}
          </div>
          <span
            className="hidden h-4 w-px shrink-0 self-center bg-[var(--border)] sm:block"
            aria-hidden
          />
          <span className="text-[11px] font-medium text-[var(--muted)]">기간</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="시작일"
            className="h-8 w-[min(100%,9.25rem)] min-w-[7.5rem] shrink-0 rounded-md border border-[var(--border)] bg-[var(--card)] px-1.5 text-xs tabular-nums text-[var(--foreground)]"
          />
          <span className="text-[11px] text-[var(--muted)]">~</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="종료일"
            className="h-8 w-[min(100%,9.25rem)] min-w-[7.5rem] shrink-0 rounded-md border border-[var(--border)] bg-[var(--card)] px-1.5 text-xs tabular-nums text-[var(--foreground)]"
          />
          <button
            type="button"
            onClick={() => {
              const t = todayRangeLocal();
              setFromDate(t.from);
              setToDate(t.to);
            }}
            className="h-8 shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--card)]"
            title="조회 기간을 오늘 하루로"
          >
            기간→오늘
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="toss-btn-primary toss-btn-sm h-8 shrink-0"
          >
            조회
          </button>
          <span className="min-w-0 flex-1 sm:flex-none" />
          <p className="w-full shrink-0 text-right text-[11px] leading-snug text-[var(--muted)] sm:ml-auto sm:w-auto sm:text-left">
            {loading
              ? "…"
              : asLedgerTodayOnly || asLedgerSearch.trim().length > 0
                ? (
                    <>
                      <span className="tabular-nums">{asLedgerRows.length}건</span>
                      <span className="text-[var(--muted)]"> · </span>
                      <span className="font-medium tabular-nums text-[var(--foreground)]">
                        {formatKRW(asLedgerTableSum)}
                      </span>
                      <span className="text-[var(--muted)]">
                        {" "}
                        (표
                        {asLedgerTodayOnly ? "·오늘" : ""}
                        {asLedgerSearch.trim().length > 0 ? "·검색" : ""})
                      </span>
                    </>
                  )
                : (
                    <>
                      <span className="tabular-nums">{asPeriodSummary.count}건</span>
                      <span className="text-[var(--muted)]"> · </span>
                      <span className="font-medium tabular-nums text-[var(--foreground)]">
                        {formatKRW(asPeriodSummary.sum)}
                      </span>
                      <span className="text-[var(--muted)]"> (기간)</span>
                    </>
                  )}
          </p>
        </div>
        <p className="pt-1.5 text-[10px] leading-snug tracking-tight text-[var(--muted)]">
          매입·매출 내역과 같이 등록된 기록만 표시합니다.{" "}
          <strong className="font-medium text-[var(--muted)]">관리자</strong>는{" "}
          <strong className="font-medium text-[var(--muted)]">수정</strong>으로
          내용을 고칠 수 있습니다.{" "}
          <strong className="font-medium text-[var(--muted)]">결제</strong>·
          <strong className="font-medium text-[var(--muted)]">입출고</strong>는 버튼
          클릭으로 완료 표시, 입고 후 가운데{" "}
          <strong className="font-medium text-[var(--muted)]">문자</strong>로
          안내 발송.{" "}
          <strong className="font-medium text-[var(--muted)]">비용</strong> 열 제목 클릭 →
          합산. 셀 드래그·Ctrl(⌘)+클릭 합계, Esc 해제.
        </p>
        <div
          ref={asLedgerSumRef}
          className="relative min-h-0 flex-1 overflow-auto pt-2"
        >
          <LedgerSelectionSumBar
            rootRef={asLedgerSumRef}
            clipboardCopy={asLedgerClipboardCopy}
            headerClickSumColumns={[5]}
          />
          <table className="ledger-cell-select w-full min-w-full cursor-cell select-none border-separate border-spacing-0 text-center text-sm tabular-nums tracking-tight">
            <thead className="toss-table-head sticky top-0 z-10 text-xs font-medium shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th className="min-w-[5.5rem] whitespace-nowrap px-2 py-2">날짜</th>
                <th className="px-2.5 py-2">이름</th>
                <th className="px-2.5 py-2">전화번호</th>
                <th className="px-2.5 py-2">제품명</th>
                <th className="px-2.5 py-2">수리내용</th>
                <th
                  className="min-w-[5rem] cursor-pointer whitespace-nowrap px-2.5 py-2 hover:bg-[var(--surface-subtle)]"
                  title="클릭하면 표시된 행의 비용 합산"
                >
                  비용
                </th>
                <th className="w-14 px-2 py-2">결제</th>
                <th className="min-w-[5.5rem] whitespace-nowrap px-1.5 py-2">
                  입출고
                </th>
                {isAdmin ? <th className="w-11 px-2 py-2">수정</th> : null}
                <th className="w-12 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={tableColSpan} className="px-3 py-10 text-center text-sm text-[var(--muted)]">
                    불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="px-3 py-10 text-center text-sm text-[var(--muted)]">
                    이 기간에 AS 기록이 없습니다.
                  </td>
                </tr>
              ) : asLedgerRows.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="px-3 py-10 text-center text-sm text-[var(--muted)]">
                    {asLedgerSearch.trim().length > 0
                      ? `“${asLedgerSearch.trim()}” 검색 결과가 없습니다.`
                      : `조회된 기간 안에 오늘(${todayYmdSeoul()}) 등록 AS가 없습니다.`}
                  </td>
                </tr>
              ) : (
                asLedgerRows.map((r) => {
                  const costNum =
                    r.cost_won != null && Number.isFinite(Number(r.cost_won))
                      ? Math.round(Number(r.cost_won))
                      : null;
                  const ledgerDt = purchaseLedgerDateCellParts(r.created_at);
                  const phoneDisp =
                    r.customer_phone?.trim()
                      ? formatMobileInputDisplay(
                          normalizeKoreanMobilePhone(r.customer_phone),
                        )
                      : "";
                  const receivedDone = isDoneMark(r.received_note);
                  const shippedDone = isDoneMark(r.shipped_note);
                  const paidDone = isDoneMark(r.paid_note);
                  const noChargeCost = costNum == null || costNum === 0;
                  return (
                  <tr
                    key={r.id}
                    data-ledger-row={r.id}
                    className="hover:bg-gray-100/80 dark:hover:bg-gray-800/40"
                  >
                    <td className="min-w-[5.5rem] whitespace-nowrap px-2 py-1.5 text-center text-xs tabular-nums text-[var(--foreground)]">
                      <span className="block leading-tight">{ledgerDt.date}</span>
                      {ledgerDt.timeHm != null ? (
                        <span className="mt-0.5 block text-[10px] font-normal leading-none tabular-nums text-[var(--muted)]">
                          {ledgerDt.timeHm}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[6rem] truncate px-2.5 py-2 text-xs text-[var(--foreground)]">
                      {r.customer_name?.trim() ? r.customer_name : "—"}
                    </td>
                    <td
                      className="max-w-[7rem] whitespace-nowrap px-2.5 py-2 text-xs text-[var(--foreground)]"
                      data-clipboard-text={phoneDisp || ""}
                    >
                      {phoneDisp || "—"}
                    </td>
                    <td className="max-w-[7rem] truncate px-2.5 py-2 text-xs text-[var(--foreground)]">
                      {r.product_name?.trim() ? r.product_name : "—"}
                    </td>
                    <td className="max-w-[12rem] truncate px-2.5 py-2 text-xs text-[var(--foreground)]">
                      {r.repair_note?.trim() ? r.repair_note : "—"}
                    </td>
                    <td
                      className="px-2.5 py-2 text-xs font-medium tabular-nums text-[var(--foreground)]"
                      {...(costNum != null ? { "data-sum-won": String(costNum) } : {})}
                    >
                      {costNum != null ? formatKRW(costNum) : "—"}
                    </td>
                    <td
                      className="px-2.5 py-2 align-middle text-xs"
                      data-clipboard-text={paidDone || noChargeCost ? "완" : "–"}
                    >
                      {noChargeCost ? (
                        <span className="font-semibold text-emerald-700">완</span>
                      ) : (
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() =>
                              void updateRow(r.id, {
                                paid_note: paidDone ? null : "완료",
                              })
                            }
                            className={asIoToggleBtn(paidDone, "emerald")}
                            title={
                              paidDone
                                ? "결제완료 — 클릭하면 취소"
                                : "클릭하면 결제완료"
                            }
                          >
                            {paidDone ? "완" : "–"}
                          </button>
                        </div>
                      )}
                    </td>
                    <td
                      className="whitespace-nowrap px-1.5 py-2 align-middle text-xs"
                      data-clipboard-text={`${receivedDone ? "완" : "–"}/${shippedDone ? "완" : "–"}`}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            void saveReceivedNote(r, receivedDone ? "" : "완")
                          }
                          className={asIoToggleBtn(receivedDone, "sky")}
                          title={
                            receivedDone
                              ? "입고완료 — 클릭하면 취소"
                              : "클릭하면 입고완료"
                          }
                        >
                          {receivedDone ? "완" : "–"}
                        </button>
                        {(() => {
                          const smsSent = Boolean(r.arrival_sms_sent_at);
                          const canSms =
                            receivedDone && Boolean(r.customer_phone?.trim());
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
                                    context: "as",
                                  }),
                                  () => void markArrivalSmsSent(r.id),
                                  { sourceScope: "as", sourceId: r.id },
                                );
                              }}
                              className={asIoSmsBtn(smsSent, canSms)}
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
                        <button
                          type="button"
                          onClick={() =>
                            void updateRow(r.id, {
                              shipped_note: shippedDone ? null : "완료",
                            })
                          }
                          className={asIoToggleBtn(shippedDone, "emerald")}
                          title={
                            shippedDone
                              ? "출고완료 — 클릭하면 취소"
                              : "클릭하면 출고완료"
                          }
                        >
                          {shippedDone ? "완" : "–"}
                        </button>
                      </div>
                    </td>
                    {isAdmin ? (
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => setEditingAsRow(r)}
                          className="text-xs text-[var(--foreground)] hover:underline"
                        >
                          수정
                        </button>
                      </td>
                    ) : null}
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => void removeRow(r.id)}
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
        <AsLedgerEditDialog
          supabase={supabase}
          row={editingAsRow}
          open={editingAsRow != null}
          onClose={() => setEditingAsRow(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}


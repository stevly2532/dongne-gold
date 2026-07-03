"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpTooltip } from "@/components/HelpTooltip";
import { createClient } from "@/lib/supabase/client";
import {
  formatKRW,
  formatDateTime,
  formatWonInputDisplay,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
  seoulYmdToUtcRangeIso,
  todayYmdSeoul,
} from "@/lib/format";
import {
  inventoryCashDepositReceivedWon,
  isCashLikePaymentMethod,
  type InventoryCashDepositRow,
} from "@/lib/inventoryCashDeposit";
import {
  branchLabelForId,
  branchSelectRowsForShop,
  branchesForShopSelect,
  firstShopSelectableBranchId,
  renameFirstBonjeomInDb,
} from "@/lib/branchLabels";
import {
  GOLD_PURCHASE_KARAT_OPTIONS,
  calculateGoldPurchase,
  ledgerDisplayDonFromWeightG,
  normalizeGoldKaratForPurchase,
  type FeeTier,
} from "@/lib/goldPurchase";
import {
  SILVER_PURITIES,
  calculateSilverPurchase,
  defaultSilverPurity,
} from "@/lib/silverPurchase";
import {
  chigumKindLabelFromPurchase,
  chigumPureDonFromWeightG,
} from "@/lib/chigumPurchase";
import type {
  Branch,
  BranchDailyClosing,
  InventoryItem,
  Profile,
  Purchase,
  VaultMiscItem,
} from "@/types/db";

function isMissingTableError(err: { message?: string; code?: string } | null) {
  if (!err) return false;
  const m = (err.message ?? "").toLowerCase();
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    m.includes("does not exist") ||
    m.includes("schema cache")
  );
}

function isMissingColumnError(err: { message?: string; code?: string } | null) {
  if (!err) return false;
  if (err.code === "PGRST204") return true;
  const m = (err.message ?? "").toLowerCase();
  return m.includes("column") && m.includes("schema cache");
}

function sanitizeSignedWonInput(raw: string): string {
  const normalized = raw.replace(/−/g, "-").replace(/,/g, "").trim();
  const neg = normalized.startsWith("-");
  const digits = sanitizeWonInputDigits(neg ? normalized.slice(1) : normalized);
  if (!digits) return neg ? "-" : "";
  return neg ? `-${digits}` : digits;
}

function formatSignedWonDisplay(signed: string): string {
  if (!signed) return "";
  if (signed === "-") return "-";
  const neg = signed.startsWith("-");
  const body = formatWonInputDisplay(neg ? signed.slice(1) : signed);
  if (!body) return neg ? "-" : "";
  return neg ? `-${body}` : body;
}

function parseSignedWonDigits(signed: string): number {
  if (!signed || signed === "-") return 0;
  const neg = signed.startsWith("-");
  const n = parseWonDigitsToNumber(neg ? signed.slice(1) : signed);
  if (n == null || !Number.isFinite(n)) return 0;
  return neg ? -Math.round(n) : Math.round(n);
}

type VaultMiscRowDraft = {
  id: string;
  signed: string;
  note: string;
};

let vaultMiscRowSeq = 0;

function newVaultMiscRow(): VaultMiscRowDraft {
  vaultMiscRowSeq += 1;
  return { id: `misc-${vaultMiscRowSeq}`, signed: "", note: "" };
}

function signedFromAmountWon(won: number): string {
  if (!Number.isFinite(won) || won === 0) return "";
  const abs = Math.abs(Math.round(won));
  return won < 0 ? `-${abs}` : String(abs);
}

function vaultMiscRowsFromClosing(closing: BranchDailyClosing): VaultMiscRowDraft[] {
  const items = closing.vault_misc_items;
  if (Array.isArray(items) && items.length > 0) {
    return items.map((item, i) => ({
      id: `closed-${i}`,
      signed: signedFromAmountWon(Number(item.amount_won)),
      note: item.note?.trim() ?? "",
    }));
  }
  const misc = Number(closing.vault_misc_adjustment_won ?? 0);
  if (Number.isFinite(misc) && misc !== 0) {
    return [
      {
        id: "legacy",
        signed: signedFromAmountWon(misc),
        note: closing.vault_misc_note?.trim() ?? "",
      },
    ];
  }
  return [newVaultMiscRow()];
}

function vaultMiscItemsFromClosing(closing: BranchDailyClosing): VaultMiscItem[] {
  const items = closing.vault_misc_items;
  if (Array.isArray(items) && items.length > 0) {
    return items.map((item) => ({
      amount_won: Math.round(Number(item.amount_won)),
      note: item.note?.trim() || null,
    }));
  }
  const misc = Number(closing.vault_misc_adjustment_won ?? 0);
  if (Number.isFinite(misc) && misc !== 0) {
    return [{ amount_won: Math.round(misc), note: closing.vault_misc_note?.trim() || null }];
  }
  return [];
}

function buildVaultMiscItemsForSave(rows: VaultMiscRowDraft[]): VaultMiscItem[] {
  return rows
    .map((row) => ({
      amount_won: parseSignedWonDigits(row.signed),
      note: row.note.trim() || null,
    }))
    .filter((item) => item.amount_won !== 0 || item.note);
}

function sumVaultMiscItems(items: VaultMiscItem[]): number {
  return items.reduce((sum, item) => sum + item.amount_won, 0);
}

type DayAgg = {
  cashSumWon: number;
  totalAmount: number;
  count: { gold: number; silver: number; chigum: number; other: number };
  weight: { gold: number; silver: number; chigum: number };
  amount: { gold: number; silver: number; chigum: number; other: number };
};

function aggregateDayPurchases(rows: Purchase[]): DayAgg {
  const count = { gold: 0, silver: 0, chigum: 0, other: 0 };
  const weight = { gold: 0, silver: 0, chigum: 0 };
  const amount = { gold: 0, silver: 0, chigum: 0, other: 0 };
  let cashSumWon = 0;
  let totalAmount = 0;
  for (const p of rows) {
    const amt = Number(p.total_amount);
    if (!Number.isFinite(amt)) continue;
    totalAmount += amt;
    if (p.payment_method === "현금") cashSumWon += amt;
    const wRaw = p.weight_g;
    const w =
      wRaw != null && Number.isFinite(Number(wRaw)) ? Number(wRaw) : 0;
    const t = p.item_type;
    if (t === "금") {
      count.gold++;
      weight.gold += w;
      amount.gold += amt;
    } else if (t === "은") {
      count.silver++;
      weight.silver += w;
      amount.silver += amt;
    } else if (t === "치금") {
      count.chigum++;
      weight.chigum += w;
      amount.chigum += amt;
    } else {
      count.other++;
      amount.other += amt;
    }
  }
  return { cashSumWon, totalAmount, count, weight, amount };
}

function sumCashSalesDepositWon(rows: InventoryCashDepositRow[]): number {
  let sum = 0;
  for (const row of rows) {
    if (!isCashLikePaymentMethod(row.payment_method)) continue;
    const amt = inventoryCashDepositReceivedWon(row);
    if (amt == null) continue;
    sum += amt;
  }
  return sum;
}

function formatWeightG(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const r = Math.round(n * 10000) / 10000;
  return r.toLocaleString("ko-KR", {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  });
}

function formatDon(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return Number(n.toFixed(2)).toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

type GradeWeightTotals = {
  count: number;
  weightG: number;
  weightDon: number;
  pureGoldDon: number;
  amountWon: number;
};

function purchaseDonFields(p: Purchase): { weightDon: number; pureGoldDon: number } {
  const w =
    p.weight_g != null && Number.isFinite(Number(p.weight_g)) ? Number(p.weight_g) : 0;
  if (w <= 0) return { weightDon: 0, pureGoldDon: 0 };

  const storedDon =
    p.weight_don_raw != null && Number.isFinite(Number(p.weight_don_raw))
      ? Number(p.weight_don_raw)
      : null;
  const storedPure =
    p.pure_gold_don != null && Number.isFinite(Number(p.pure_gold_don))
      ? Number(p.pure_gold_don)
      : null;

  if (p.item_type === "은") {
    const calc = calculateSilverPurchase({
      pricePerDon: 0,
      weightG: w,
      purity: defaultSilverPurity(p.purity),
    });
    return {
      weightDon: storedDon ?? calc?.rawDon ?? ledgerDisplayDonFromWeightG(w),
      pureGoldDon: storedPure ?? calc?.billableDon ?? storedDon ?? 0,
    };
  }

  if (p.item_type === "치금") {
    const kind = chigumKindLabelFromPurchase(p);
    return {
      weightDon: storedDon ?? ledgerDisplayDonFromWeightG(w),
      pureGoldDon: chigumPureDonFromWeightG(w, kind),
    };
  }

  if (p.item_type === "금") {
    if (storedDon != null && storedPure != null) {
      return { weightDon: storedDon, pureGoldDon: storedPure };
    }
    const tier = (p.fee_tier?.trim() || "a") as FeeTier;
    const calc = calculateGoldPurchase({
      pricePerDon: 0,
      weightG: w,
      karat: p.karat?.trim() || "",
      feeTier: tier,
      chigum: false,
    });
    if (calc) {
      return { weightDon: calc.weightDonRaw, pureGoldDon: calc.pureGoldDon };
    }
    return {
      weightDon: ledgerDisplayDonFromWeightG(w),
      pureGoldDon: 0,
    };
  }

  return {
    weightDon: storedDon ?? ledgerDisplayDonFromWeightG(w),
    pureGoldDon: storedPure ?? 0,
  };
}

function is24KFamilyPurchaseKarat(karat: string | null | undefined): boolean {
  const k = normalizeGoldKaratForPurchase(karat?.trim() || "");
  return k === "24K" || k === "24K-1";
}

function sumPurchase24KFamilyPureDon(rows: Purchase[]): number {
  let sum = 0;
  for (const p of rows) {
    if (p.item_type !== "금" || !is24KFamilyPurchaseKarat(p.karat)) continue;
    sum += purchaseDonFields(p).pureGoldDon;
  }
  return sum;
}

/** 매출등록 kind=gold(24K)만 해당 — 24K·24K-1 순금돈 합 */
function sumSales24KFamilyPureDon(
  rows: Pick<InventoryItem, "kind" | "weight_g">[],
): number {
  let sum = 0;
  for (const r of rows) {
    if (r.kind !== "gold") continue;
    const w = r.weight_g != null ? Number(r.weight_g) : NaN;
    if (!Number.isFinite(w) || w <= 0) continue;
    const don = ledgerDisplayDonFromWeightG(w);
    if (Number.isFinite(don) && don > 0) sum += don;
  }
  return sum;
}

function BreakdownWeightLine({
  row,
  showPureGoldDon,
  staffPureGoldHighlight = false,
}: {
  row: GradeBreakdownRow;
  showPureGoldDon: boolean;
  /** 직원 화면 — 순금돈 파란 강조 (관리자는 보라) */
  staffPureGoldHighlight?: boolean;
}) {
  if (!row.showDonColumns) {
    return row.weightG > 0 ? `${formatWeightG(row.weightG)} g` : "0 g";
  }
  const gPart = `${formatWeightG(row.weightG)} g`;
  const donPart = `${formatDon(row.weightDon)}돈`;
  if (!showPureGoldDon || row.showPureGoldDon === false) {
    return (
      <>
        {gPart} · {donPart}
      </>
    );
  }
  const pureClass = staffPureGoldHighlight
    ? "closing-pure-don-staff"
    : "closing-pure-don-admin";
  return (
    <>
      {gPart} · {donPart} ·{" "}
      <span className={pureClass}>
        순금 {formatDon(row.pureGoldDon)}돈
      </span>
    </>
  );
}

function PurchaseBreakdownBlock({
  title,
  hint,
  rows,
  showWeightColumn,
  showPureGoldDon = false,
  staffPureGoldHighlight = false,
  compact = false,
}: {
  title: string;
  hint?: string;
  rows: GradeBreakdownRow[];
  showWeightColumn: boolean;
  /** 금·치금 순금돈수 표시 */
  showPureGoldDon?: boolean;
  /** 직원 — 순금돈 파란 강조 */
  staffPureGoldHighlight?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "closing-breakdown-block closing-breakdown-block--compact"
          : "closing-breakdown-block"
      }
    >
      <div className={compact ? "mb-1" : "mb-1.5"}>
        <h3 className="closing-breakdown-title">{title}</h3>
        {hint && !compact ? (
          <p className="tongsang-guide-text mt-0.5">{hint}</p>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">당일 매입 없음</p>
      ) : (
        <div className="mt-1 flex w-full flex-col">
          {rows.map((r) => (
            <div key={r.gradeLabel} className="closing-breakdown-row">
              <span className="min-w-0 shrink font-medium text-[var(--foreground)]">
                {r.gradeLabel}
              </span>
              <span className="shrink-0 text-right text-[12px] leading-snug tabular-nums text-[var(--foreground)] sm:text-sm">
                {showWeightColumn ? (
                  <BreakdownWeightLine
                    row={r}
                    showPureGoldDon={showPureGoldDon}
                    staffPureGoldHighlight={staffPureGoldHighlight}
                  />
                ) : (
                  formatKRW(r.amountWon)
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type GradeBreakdownRow = {
  gradeLabel: string;
  count: number;
  weightG: number;
  weightDon: number;
  pureGoldDon: number;
  amountWon: number;
  showDonColumns?: boolean;
  /** false면 은 등 — 순금돈수 미표시 */
  showPureGoldDon?: boolean;
};

/** 매입 등록(품목 치금) 함량 셀렉트와 동일 */
const CHIGUM_KARAT_DISPLAY_KEYS = ["크라운", "인레이"] as const;

function extraGradeKeysAfterCanonical(
  canonical: readonly string[],
  m: Map<string, GradeWeightTotals>,
): string[] {
  const known = new Set(canonical);
  return [...m.keys()]
    .filter((k) => !known.has(k))
    .sort((a, b) => a.localeCompare(b, "ko"));
}

function accumulateByGrade(
  rows: Purchase[],
  filter: (p: Purchase) => boolean,
  gradeKey: (p: Purchase) => string,
  includeDon: boolean,
): Map<string, GradeWeightTotals> {
  const m = new Map<string, GradeWeightTotals>();
  for (const p of rows) {
    if (!filter(p)) continue;
    const amt = Number(p.total_amount);
    if (!Number.isFinite(amt)) continue;
    const wRaw = p.weight_g;
    const w =
      wRaw != null && Number.isFinite(Number(wRaw)) ? Number(wRaw) : 0;
    const { weightDon, pureGoldDon } = includeDon
      ? purchaseDonFields(p)
      : { weightDon: 0, pureGoldDon: 0 };
    const key = gradeKey(p);
    const cur = m.get(key) ?? {
      count: 0,
      weightG: 0,
      weightDon: 0,
      pureGoldDon: 0,
      amountWon: 0,
    };
    cur.count += 1;
    cur.weightG += w;
    cur.weightDon += weightDon;
    cur.pureGoldDon += pureGoldDon;
    cur.amountWon += amt;
    m.set(key, cur);
  }
  return m;
}

/** 함량·종류 전체를 고정 순서로 나열하고, 당일 매입 없으면 0으로 표시 */
function mapBreakdownRowsAllKeys(
  m: Map<string, GradeWeightTotals>,
  orderedKeys: string[],
  showDonColumns: boolean,
  showPureGoldDon = true,
): GradeBreakdownRow[] {
  const z: GradeWeightTotals = {
    count: 0,
    weightG: 0,
    weightDon: 0,
    pureGoldDon: 0,
    amountWon: 0,
  };
  return orderedKeys.map((gradeLabel) => {
    const v = m.get(gradeLabel) ?? z;
    return {
      gradeLabel,
      count: v.count,
      weightG: v.weightG,
      weightDon: v.weightDon,
      pureGoldDon: v.pureGoldDon,
      amountWon: v.amountWon,
      showDonColumns,
      showPureGoldDon: showDonColumns ? showPureGoldDon : false,
    };
  });
}

function goldBreakdownByKarat(rows: Purchase[]): GradeBreakdownRow[] {
  const m = accumulateByGrade(
    rows,
    (p) => p.item_type === "금",
    (p) => (p.karat?.trim() ? p.karat.trim() : "미입력"),
    true,
  );
  const canonical = GOLD_PURCHASE_KARAT_OPTIONS.map((o) => o.value);
  const keys = [...canonical, ...extraGradeKeysAfterCanonical(canonical, m)];
  return mapBreakdownRowsAllKeys(m, keys, true);
}

function chigumBreakdownByKarat(rows: Purchase[]): GradeBreakdownRow[] {
  const m = accumulateByGrade(
    rows,
    (p) => p.item_type === "치금",
    (p) => (p.karat?.trim() ? p.karat.trim() : "미입력"),
    true,
  );
  const keys = [
    ...CHIGUM_KARAT_DISPLAY_KEYS,
    ...extraGradeKeysAfterCanonical(CHIGUM_KARAT_DISPLAY_KEYS, m),
  ];
  return mapBreakdownRowsAllKeys(m, keys, true);
}

function silverBreakdownByPurity(rows: Purchase[]): GradeBreakdownRow[] {
  const m = accumulateByGrade(
    rows,
    (p) => p.item_type === "은",
    (p) => defaultSilverPurity(p.purity),
    true,
  );
  const puritySet = new Set<string>(SILVER_PURITIES as readonly string[]);
  const rest = [...m.keys()]
    .filter((k) => !puritySet.has(k))
    .sort((a, b) => a.localeCompare(b, "ko"));
  return mapBreakdownRowsAllKeys(m, [...SILVER_PURITIES, ...rest], true, false);
}

export default function DailyClosingPage() {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [closingDate, setClosingDate] = useState(() => todayYmdSeoul());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayPurchases, setDayPurchases] = useState<Purchase[]>([]);
  const [daySalesGold, setDaySalesGold] = useState<
    Pick<InventoryItem, "kind" | "weight_g">[]
  >([]);
  const [dayCashSalesRows, setDayCashSalesRows] = useState<
    InventoryCashDepositRow[]
  >([]);
  const [openVaultWon, setOpenVaultWon] = useState<number | null>(null);
  const [vaultLoadFailed, setVaultLoadFailed] = useState(false);
  const [existingClosing, setExistingClosing] =
    useState<BranchDailyClosing | null>(null);
  const [history, setHistory] = useState<BranchDailyClosing[]>([]);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  /** DB에 branch_daily_closings 없음 — 시재·매입 확인은 가능, 저장만 불가 */
  const [closingLedgerUnavailable, setClosingLedgerUnavailable] =
    useState(false);
  const [ackVault, setAckVault] = useState(false);
  const [ackPurchase, setAckPurchase] = useState(false);
  const [vaultMiscRows, setVaultMiscRows] = useState<VaultMiscRowDraft[]>(() => [
    newVaultMiscRow(),
  ]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [successFlash, setSuccessFlash] = useState(false);

  const isAdmin = profile?.role === "admin";
  const staffBranchId = profile?.branch_id ?? null;
  const canUseBranchSelect = isAdmin;
  const staffNeedsBranch = !isAdmin && !staffBranchId;
  const shopBranches = useMemo(
    () => branchesForShopSelect(branches),
    [branches],
  );
  const singleShop = shopBranches.length === 1;
  const seoulToday = todayYmdSeoul();

  const agg = useMemo(() => aggregateDayPurchases(dayPurchases), [dayPurchases]);
  const goldGradeRows = useMemo(
    () => goldBreakdownByKarat(dayPurchases),
    [dayPurchases],
  );
  const silverGradeRows = useMemo(
    () => silverBreakdownByPurity(dayPurchases),
    [dayPurchases],
  );
  const chigumGradeRows = useMemo(
    () => chigumBreakdownByKarat(dayPurchases),
    [dayPurchases],
  );
  const purchase24KFamilyPureDonTotal = useMemo(
    () => sumPurchase24KFamilyPureDon(dayPurchases),
    [dayPurchases],
  );
  const sales24KFamilyPureDonTotal = useMemo(
    () => sumSales24KFamilyPureDon(daySalesGold),
    [daySalesGold],
  );
  const cashSalesSumWon = useMemo(
    () => sumCashSalesDepositWon(dayCashSalesRows),
    [dayCashSalesRows],
  );
  const vaultMiscAdjustWon = useMemo(() => {
    if (existingClosing) {
      return sumVaultMiscItems(vaultMiscItemsFromClosing(existingClosing));
    }
    return sumVaultMiscItems(buildVaultMiscItemsForSave(vaultMiscRows));
  }, [existingClosing, vaultMiscRows]);

  const savedVaultMiscItems = useMemo(
    () => (existingClosing ? vaultMiscItemsFromClosing(existingClosing) : []),
    [existingClosing],
  );
  const counterEstimatedWon =
    openVaultWon != null
      ? openVaultWon -
        agg.cashSumWon +
        cashSalesSumWon +
        vaultMiscAdjustWon
      : null;
  const vaultMissingButCashPurchases =
    openVaultWon == null && agg.cashSumWon > 0;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    setClosingLedgerUnavailable(false);
    setVaultLoadFailed(false);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("로그인이 필요합니다.");
      setLoading(false);
      return;
    }

    const [profResult, brResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, role, branch_id")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("branches")
        .select("id, name, created_at")
        .order("created_at", { ascending: true }),
    ]);

    const { data: prof, error: pe } = profResult;
    const { data: br, error: be } = brResult;
    if (pe) {
      setError(pe.message);
      setLoading(false);
      return;
    }
    setProfile(prof as Profile);

    if (be) {
      setError(be.message);
      setLoading(false);
      return;
    }
    let branchList = (br ?? []) as Branch[];
    const role = (prof as Profile)?.role;
    if (branchList.length === 0 && role === "admin") {
      const { data: created, error: ce } = await supabase
        .from("branches")
        .insert({ name: "향남점" })
        .select("id, name, created_at")
        .maybeSingle();
      if (!ce && created) branchList = [created as Branch];
    }
    if (role === "admin" && branchList.length > 0) {
      branchList = await renameFirstBonjeomInDb(supabase, branchList);
    }
    setBranches(branchList);

    const effectiveBranchId =
      role === "staff" && prof?.branch_id ? prof.branch_id : branchId;

    if (!effectiveBranchId) {
      setDayPurchases([]);
      setDaySalesGold([]);
      setDayCashSalesRows([]);
      setOpenVaultWon(null);
      setExistingClosing(null);
      setHistory([]);
      setLoading(false);
      return;
    }

    const { from: fromIso, to: toIso } = seoulYmdToUtcRangeIso(closingDate);
    const purchaseCols =
      "id, branch_id, purchased_at, item_type, weight_g, purity, total_amount, payment_method, karat, weight_don_raw, pure_gold_don, fee_tier";

    const adminLoad = role === "admin";
    const salesQuery = adminLoad
      ? supabase
          .from("inventory_items")
          .select("kind, weight_g")
          .eq("branch_id", effectiveBranchId)
          .gte("sold_at", fromIso)
          .lte("sold_at", toIso)
          .not("sold_at", "is", null)
      : Promise.resolve({ data: [], error: null });
    const cashSalesQuery = supabase
      .from("inventory_items")
      .select("sell_price, deposit_won, receivable_won, payment_method")
      .eq("branch_id", effectiveBranchId)
      .gte("sold_at", fromIso)
      .lte("sold_at", toIso)
      .not("sold_at", "is", null);

    const [puRes, salesRes, cashSalesRes, vaultRes, closedRes, histRes] =
      await Promise.all([
      supabase
        .from("purchases")
        .select(purchaseCols)
        .eq("branch_id", effectiveBranchId)
        .gte("purchased_at", fromIso)
        .lte("purchased_at", toIso)
        .order("purchased_at", { ascending: false }),
      salesQuery,
      cashSalesQuery,
      supabase
        .from("branch_vault_snapshots")
        .select("amount_won")
        .eq("branch_id", effectiveBranchId)
        .eq("vault_date", closingDate)
        .maybeSingle(),
      supabase
        .from("branch_daily_closings")
        .select("*")
        .eq("branch_id", effectiveBranchId)
        .eq("closing_date", closingDate)
        .maybeSingle(),
      supabase
        .from("branch_daily_closings")
        .select("*")
        .eq("branch_id", effectiveBranchId)
        .order("closing_date", { ascending: false })
        .limit(20),
    ]);

    if (puRes.error) {
      setError(puRes.error.message);
      setLoading(false);
      return;
    }
    setDayPurchases((puRes.data ?? []) as Purchase[]);
    setDaySalesGold(
      adminLoad && !salesRes.error
        ? ((salesRes.data ?? []) as Pick<
            InventoryItem,
            "kind" | "weight_g"
          >[])
        : [],
    );
    if (cashSalesRes.error) {
      setDayCashSalesRows([]);
    } else {
      setDayCashSalesRows((cashSalesRes.data ?? []) as InventoryCashDepositRow[]);
    }

    if (vaultRes.error) {
      if (isMissingTableError(vaultRes.error)) {
        setVaultLoadFailed(true);
        setOpenVaultWon(null);
      } else {
        setError(vaultRes.error.message);
        setLoading(false);
        return;
      }
    } else if (vaultRes.data?.amount_won != null) {
      const w = Number(vaultRes.data.amount_won);
      setOpenVaultWon(Number.isFinite(w) ? Math.floor(w) : null);
    } else {
      setOpenVaultWon(null);
    }

    if (closedRes.error) {
      if (isMissingTableError(closedRes.error)) {
        setClosingLedgerUnavailable(true);
        setExistingClosing(null);
      } else {
        setError(closedRes.error.message);
        setLoading(false);
        return;
      }
    } else {
      const closing = (closedRes.data as BranchDailyClosing | null) ?? null;
      setExistingClosing(closing);
      if (closing) {
        setVaultMiscRows(vaultMiscRowsFromClosing(closing));
      } else {
        setVaultMiscRows([newVaultMiscRow()]);
      }
    }

    if (histRes.error) {
      if (isMissingTableError(histRes.error)) {
        setHistoryLoadError(null);
        setHistory([]);
      } else {
        setHistoryLoadError(histRes.error.message);
        setHistory([]);
      }
    } else {
      setHistoryLoadError(null);
      setHistory((histRes.data ?? []) as BranchDailyClosing[]);
    }

    setLoading(false);
  }, [supabase, branchId, closingDate]);

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
    setAckVault(false);
    setAckPurchase(false);
    setNote("");
    setVaultMiscRows([newVaultMiscRow()]);
  }, [closingDate, branchId]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load({ silent: true });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  function updateVaultMiscRow(
    id: string,
    patch: Partial<Pick<VaultMiscRowDraft, "signed" | "note">>,
  ) {
    setVaultMiscRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  function addVaultMiscRow() {
    setVaultMiscRows((rows) => [...rows, newVaultMiscRow()]);
  }

  function removeVaultMiscRow(id: string) {
    setVaultMiscRows((rows) =>
      rows.length <= 1 ? rows : rows.filter((row) => row.id !== id),
    );
  }

  async function handleCompleteClose() {
    const effectiveBranchId =
      profile?.role === "staff" && profile.branch_id
        ? profile.branch_id
        : branchId;
    if (!effectiveBranchId || existingClosing) return;
    if (!ackVault || !ackPurchase) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("로그인이 필요합니다.");
      return;
    }
    setSaving(true);
    setError(null);
    const a = aggregateDayPurchases(dayPurchases);
    const open = openVaultWon;
    const miscItems = buildVaultMiscItemsForSave(vaultMiscRows);
    const miscWon = sumVaultMiscItems(miscItems);
    const counter =
      open != null
        ? open - a.cashSumWon + sumCashSalesDepositWon(dayCashSalesRows) + miscWon
        : null;
    const round4 = (n: number) => Math.round(n * 10000) / 10000;
    const insertPayload = {
      branch_id: effectiveBranchId,
      closing_date: closingDate,
      closed_by: user.id,
      note: note.trim() || null,
      open_vault_won: open,
      today_cash_purchase_sum_won: Math.round(a.cashSumWon),
      counter_won_estimated: counter != null ? Math.round(counter) : null,
      vault_misc_adjustment_won: Math.round(miscWon),
      vault_misc_note: null,
      vault_misc_items: miscItems,
      purchase_count_gold: a.count.gold,
      purchase_count_silver: a.count.silver,
      purchase_count_chigum: a.count.chigum,
      purchase_count_other: a.count.other,
      weight_g_gold: round4(a.weight.gold),
      weight_g_silver: round4(a.weight.silver),
      weight_g_chigum: round4(a.weight.chigum),
      amount_won_gold: Math.round(a.amount.gold),
      amount_won_silver: Math.round(a.amount.silver),
      amount_won_chigum: Math.round(a.amount.chigum),
      amount_won_other: Math.round(a.amount.other),
      amount_won_total: Math.round(a.totalAmount),
      checklist_vault_ack: ackVault,
      checklist_purchase_ack: ackPurchase,
    };
    let { error: insErr } = await supabase
      .from("branch_daily_closings")
      .insert(insertPayload);
    if (insErr && isMissingColumnError(insErr)) {
      const {
        vault_misc_adjustment_won: _m,
        vault_misc_note: _n,
        vault_misc_items: _i,
        ...legacy
      } = insertPayload;
      void _m;
      void _n;
      void _i;
      const retry = await supabase.from("branch_daily_closings").insert(legacy);
      insErr = retry.error;
      if (!insErr) {
        setError(
          "마감은 저장됐으나 기타 현금 조정은 반영되지 않았습니다. Supabase에서 migration_branch_daily_closings_vault_misc.sql을 실행하세요.",
        );
      }
    }
    setSaving(false);
    if (insErr) {
      if (insErr.code === "23505") {
        setError(
          "해당 날짜는 이미 마감되어 있습니다. 목록을 새로고침 해 보세요.",
        );
      } else if (isMissingTableError(insErr)) {
        setClosingLedgerUnavailable(true);
        setError("마감을 저장할 수 없습니다. 관리자에게 문의하세요.");
      } else {
        setError(insErr.message || "마감 저장에 실패했습니다.");
      }
      return;
    }
    setSuccessFlash(true);
    if (typeof window !== "undefined") {
      window.setTimeout(() => setSuccessFlash(false), 2800);
    }
    await load({ silent: true });
  }

  const branchRows = branchSelectRowsForShop(branches);
  const effectiveBranchIdForUi =
    profile?.role === "staff" && profile.branch_id
      ? profile.branch_id
      : branchId;
  const canSubmit =
    !staffNeedsBranch &&
    !!effectiveBranchIdForUi &&
    !existingClosing &&
    !closingLedgerUnavailable &&
    ackVault &&
    ackPurchase &&
    !loading &&
    !saving;

  const workCard = "tongsang-work-card space-y-3";
  const sectionTitle = "tongsang-work-card-title text-base sm:text-lg";

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-3 sm:px-4 lg:px-5">
      <header className="mb-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-start gap-3">
            <div className="min-w-0">
              <h1 className="purchase-ledger-header-title">일일 마감</h1>
              <p className="purchase-ledger-header-desc">
                <HelpTooltip label="일일 마감 도움말" trigger="text">
                  당일 시재(오픈 금고·현금 매입 합·카운터 추정)와 금·은·치금 매입
                  중량을 확인한 뒤 마감 완료 시 장부에 스냅샷이 남습니다. 한국
                  날짜({seoulToday}) 기준입니다.
                </HelpTooltip>
              </p>
            </div>
            {isAdmin && effectiveBranchIdForUi ? (
              <div className="toss-highlight-panel w-full shrink-0 px-2.5 py-2 sm:w-auto sm:min-w-[11rem]">
                <p className="flex items-center justify-between gap-2 text-[11px] font-semibold text-[var(--foreground)]">
                  <span>당일 순금 (24K·24K-1)</span>
                  <span className="toss-badge">관리자</span>
                </p>
                <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-[var(--foreground)]">
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-[var(--muted)]">매입</span>
                    <span className="font-semibold tabular-nums">
                      {loading
                        ? "…"
                        : `${formatDon(purchase24KFamilyPureDonTotal)}돈`}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-[var(--muted)]">매출</span>
                    <span className="font-semibold tabular-nums">
                      {loading
                        ? "…"
                        : `${formatDon(sales24KFamilyPureDonTotal)}돈`}
                    </span>
                  </li>
                </ul>
              </div>
            ) : null}
          </div>
          <div className="min-w-[10rem] shrink-0">
            <label className="tongsang-field-label" htmlFor="closing-date">
              마감 일자 (KST)
            </label>
            <input
              id="closing-date"
              type="date"
              className="tongsang-field-input tabular-nums"
              value={closingDate}
              onChange={(e) => setClosingDate(e.target.value)}
            />
          </div>
        </div>
        {closingDate !== seoulToday ? (
          <p className="closing-status-warn mt-3">
            오늘이 아닌 날짜입니다. 누락된 일자 보정·확인용으로만 사용하세요.
          </p>
        ) : null}
      </header>

      {canUseBranchSelect && !singleShop ? (
      <section className="tongsang-period-panel">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="min-w-[8rem]">
              <label className="tongsang-field-label" htmlFor="closing-branch">
                매장
              </label>
              <select
                id="closing-branch"
                className="tongsang-field-input"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                {branchRows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
        </div>
      </section>
      ) : null}

      {staffNeedsBranch ? (
        <div className="closing-status-warn">
          소속 매장이 없습니다. (직원 모드) 관리자에게 지점을 배정해 달라고 하세요.
        </div>
      ) : null}

      {error ? (
        <div className="toss-alert-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      {successFlash ? (
        <div className="closing-status-ok">
          마감이 저장되었습니다.
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">불러오는 중…</p>
      ) : (
        <>
          {existingClosing ? (
            <div className="closing-status-ok">
              <span className="font-semibold">
                {closingDate} — 이미 마감됨
              </span>
              <span className="ml-2 text-[var(--muted)]">
                {formatDateTime(existingClosing.closed_at)} 기록
              </span>
            </div>
          ) : null}

          <div className="closing-top-grid">
          <section className={workCard}>
            <h2 className={sectionTitle}>1. 시재 확인</h2>
            <p className="tongsang-guide-text">
              매입 등록 화면과 동일합니다. 오픈 금고에서 현금 매입을 빼고
              현금·현영 매출을 더합니다. 수리·이벤트 등 장부에 없는 현금은
              기타에 ±로 넣으면 카운터 추정 시재에 반영됩니다.
            </p>
            {vaultLoadFailed ? (
              <p className="closing-status-warn">
                시재 테이블을 읽지 못했습니다.{" "}
                <code className="rounded bg-white/60 px-1 dark:bg-black/20">
                  migration_branch_vault_snapshots.sql
                </code>{" "}
                적용 여부를 확인하세요.
              </p>
            ) : null}
            <div className="closing-vault-calc closing-vault-calc--ledger">
              <ol className="closing-vault-ledger">
                <li className="closing-vault-ledger-item closing-vault-ledger-item--base">
                  <span className="closing-vault-ledger-op" aria-hidden />
                  <div className="closing-vault-ledger-main closing-stat-tile">
                    <span className="closing-vault-ledger-label">
                      오픈 금고 시재
                    </span>
                    <span className="closing-vault-ledger-amount">
                      {openVaultWon != null
                        ? formatKRW(openVaultWon)
                        : "미등록"}
                    </span>
                  </div>
                </li>
                <li className="closing-vault-ledger-item closing-vault-ledger-item--out">
                  <span
                    className="closing-vault-ledger-op closing-vault-ledger-op--minus"
                    aria-hidden
                  >
                    −
                  </span>
                  <div className="closing-vault-ledger-main closing-stat-tile">
                    <span className="closing-vault-ledger-label">
                      당일 현금 매입
                    </span>
                    <span className="closing-vault-ledger-amount text-amount-out">
                      −{formatKRW(agg.cashSumWon)}
                    </span>
                  </div>
                </li>
                <li className="closing-vault-ledger-item closing-vault-ledger-item--in">
                  <span
                    className="closing-vault-ledger-op closing-vault-ledger-op--plus"
                    aria-hidden
                  >
                    +
                  </span>
                  <div className="closing-vault-ledger-main closing-stat-tile">
                    <span className="closing-vault-ledger-label">
                      당일 현금 매출
                      <span className="closing-vault-ledger-sub">
                        현금·현영
                      </span>
                    </span>
                    <span className="closing-vault-ledger-amount text-positive">
                      +{formatKRW(cashSalesSumWon)}
                    </span>
                  </div>
                </li>
                {existingClosing ? (
                  savedVaultMiscItems.length > 0 ? (
                    savedVaultMiscItems.map((item, index) => {
                      const won = item.amount_won;
                      return (
                        <li
                          key={`misc-${index}`}
                          className="closing-vault-ledger-item closing-vault-ledger-item--misc"
                        >
                          <span
                            className={`closing-vault-ledger-op ${
                              index === 0
                                ? "closing-vault-ledger-op--misc"
                                : "closing-vault-ledger-op--spacer"
                            }`}
                            aria-hidden
                          >
                            {index === 0 ? "±" : ""}
                          </span>
                          <div className="closing-vault-ledger-main closing-stat-tile closing-vault-ledger-main--misc">
                            <div className="closing-vault-misc-oneline closing-vault-misc-oneline--read">
                              <span className="closing-vault-ledger-label closing-vault-misc-oneline-tag">
                                {index === 0 ? "기타" : ""}
                              </span>
                              <span className="closing-vault-misc-oneline-note">
                                {item.note?.trim() || "—"}
                              </span>
                              <span
                                className={`closing-vault-ledger-amount closing-vault-misc-oneline-amount ${
                                  won > 0
                                    ? "text-positive"
                                    : won < 0
                                      ? "text-amount-out"
                                      : ""
                                }`}
                              >
                                {won > 0
                                  ? `+${formatKRW(won)}`
                                  : won < 0
                                    ? `−${formatKRW(Math.abs(won))}`
                                    : formatKRW(0)}
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })
                  ) : (
                    <li className="closing-vault-ledger-item closing-vault-ledger-item--misc">
                      <span
                        className="closing-vault-ledger-op closing-vault-ledger-op--misc"
                        aria-hidden
                      >
                        ±
                      </span>
                      <div className="closing-vault-ledger-main closing-stat-tile closing-vault-ledger-main--misc">
                        <div className="closing-vault-misc-oneline closing-vault-misc-oneline--read">
                          <span className="closing-vault-ledger-label closing-vault-misc-oneline-tag">
                            기타
                          </span>
                          <span className="closing-vault-misc-oneline-note">—</span>
                          <span className="closing-vault-ledger-amount closing-vault-misc-oneline-amount tabular-nums">
                            {formatKRW(0)}
                          </span>
                        </div>
                      </div>
                    </li>
                  )
                ) : (
                  <>
                    {vaultMiscRows.map((row, index) => (
                      <li
                        key={row.id}
                        className="closing-vault-ledger-item closing-vault-ledger-item--misc"
                      >
                        <span
                          className={`closing-vault-ledger-op ${
                            index === 0
                              ? "closing-vault-ledger-op--misc"
                              : "closing-vault-ledger-op--spacer"
                          }`}
                          aria-hidden
                        >
                          {index === 0 ? "±" : ""}
                        </span>
                        <div className="closing-vault-ledger-main closing-stat-tile closing-vault-ledger-main--misc">
                          <div className="closing-vault-misc-oneline closing-vault-misc-oneline--edit">
                            <div className="closing-vault-misc-label-col">
                              <span className="closing-vault-ledger-label">
                                {index === 0 ? "기타" : ""}
                              </span>
                              {index === 0 ? (
                                <button
                                  type="button"
                                  onClick={addVaultMiscRow}
                                  className="closing-vault-misc-add-btn"
                                >
                                  + 줄 추가
                                </button>
                              ) : null}
                            </div>
                            <div className="closing-vault-misc-note-wrap">
                              <input
                                type="text"
                                placeholder="내용"
                                aria-label="기타 내용"
                                value={row.note}
                                onChange={(e) =>
                                  updateVaultMiscRow(row.id, { note: e.target.value })
                                }
                                className="closing-vault-misc-note-input tongsang-field-input"
                              />
                            </div>
                            <div className="closing-vault-misc-amount-wrap">
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="금액"
                                aria-label="기타 금액"
                                value={formatSignedWonDisplay(row.signed)}
                                onChange={(e) =>
                                  updateVaultMiscRow(row.id, {
                                    signed: sanitizeSignedWonInput(e.target.value),
                                  })
                                }
                                className="closing-vault-ledger-amount closing-vault-misc-amount-input tabular-nums"
                              />
                              {vaultMiscRows.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => removeVaultMiscRow(row.id)}
                                  className="closing-vault-misc-remove-btn"
                                  aria-label="기타 줄 삭제"
                                >
                                  삭제
                                </button>
                              ) : null}
                            </div>
                          </div>
                          {index === vaultMiscRows.length - 1 &&
                          vaultMiscRows.length > 1 &&
                          vaultMiscAdjustWon !== 0 ? (
                            <p className="closing-vault-misc-sum tabular-nums">
                              합계{" "}
                              <span
                                className={
                                  vaultMiscAdjustWon > 0
                                    ? "text-positive"
                                    : vaultMiscAdjustWon < 0
                                      ? "text-amount-out"
                                      : ""
                                }
                              >
                                {vaultMiscAdjustWon > 0
                                  ? `+${formatKRW(vaultMiscAdjustWon)}`
                                  : vaultMiscAdjustWon < 0
                                    ? `−${formatKRW(Math.abs(vaultMiscAdjustWon))}`
                                    : formatKRW(0)}
                              </span>
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </>
                )}
              </ol>
              <div className="closing-vault-calc-result">
                <p className="closing-vault-calc-result-label">
                  카운터 추정 시재
                </p>
                <p className="closing-vault-calc-result-amount tongsang-karat-num-accent">
                  {counterEstimatedWon != null
                    ? formatKRW(counterEstimatedWon)
                    : "–"}
                </p>
              </div>
            </div>
            {openVaultWon == null ? (
              <p className="text-xs leading-snug text-[var(--muted)]">
                오픈 금고 시재는 매입 등록 화면에서 저장합니다. 미등록이면
                카운터 추정 시재를 계산할 수 없습니다.
              </p>
            ) : null}
            {vaultMissingButCashPurchases ? (
              <p className="closing-status-warn">
                오픈 시재가 없는데 현금 매입이 있습니다. 실제 금고와 맞는지 매입
                화면에서 시재를 먼저 맞춘 뒤 마감하세요.
              </p>
            ) : null}
            <label className="closing-check-label justify-end">
              <input
                type="checkbox"
                checked={ackVault}
                disabled={!!existingClosing}
                onChange={(e) => setAckVault(e.target.checked)}
              />
              <span className="text-right">
                위 시재·현금 매입 합·현금 매출 합·카운터 추정을 실제와 대조해
                확인했습니다.
              </span>
            </label>
          </section>

          <section className={`${workCard} space-y-3`}>
            <div>
              <h2 className={sectionTitle}>2. 당일 매입 (함량·종류별 중량)</h2>
              <p className="tongsang-guide-text mt-1">
                함량 목록은 매입 등록에서 품목별로 고를 수 있는 것과 같습니다(금: 순금·합금, 치금: 크라운·인레이, 은: 925 등).{" "}
                {isAdmin ? (
                  <>
                    금·치금은{" "}
                    <span className="font-medium text-[var(--foreground)]">함량 · g · 돈수</span>
                    와{" "}
                    <span className="closing-pure-don-admin font-medium">순금돈수(관리자)</span>
                    , 은은{" "}
                    <span className="font-medium text-[var(--foreground)]">함량 · g · 돈수</span>{" "}
                    로 표시됩니다.
                  </>
                ) : (
                  <>
                    금·치금은{" "}
                    <span className="font-medium text-[var(--foreground)]">
                      함량 · g · 돈수
                    </span>
                    와{" "}
                    <span className="closing-pure-don-staff font-medium">
                      순금돈수
                    </span>
                    , 은은{" "}
                    <span className="font-medium text-[var(--foreground)]">
                      함량 · g · 돈수
                    </span>{" "}
                    로 표시됩니다.
                  </>
                )}
              </p>
            </div>

            <div className="flex w-full flex-col gap-2">
              <div className="closing-metal-grid">
                <PurchaseBreakdownBlock
                  title="금"
                  hint={
                    isAdmin
                      ? "매입 등록 함량과 동일 · g · 돈 · 순금돈(관리자)"
                      : "매입 등록 함량과 동일 · g · 돈 · 순금돈"
                  }
                  rows={goldGradeRows}
                  showWeightColumn
                  showPureGoldDon
                  staffPureGoldHighlight={!isAdmin}
                  compact
                />
                <PurchaseBreakdownBlock
                  title="은"
                  hint="매입 등록 함량과 동일 · g · 돈"
                  rows={silverGradeRows}
                  showWeightColumn
                  compact
                />
                <PurchaseBreakdownBlock
                  title="치금"
                  hint={
                    isAdmin
                      ? "크라운 0.55 · 인레이 0.8 순금돈(관리자)"
                      : "크라운·인레이 · g · 돈 · 순금돈"
                  }
                  rows={chigumGradeRows}
                  showWeightColumn
                  showPureGoldDon
                  staffPureGoldHighlight={!isAdmin}
                  compact
                />
              </div>
            </div>

            <div className="closing-total-bar tabular-nums">
              <span className="font-semibold">전체 합계</span>
              <span className="mx-2 text-[var(--muted)]">·</span>
              건수{" "}
              <strong>
                {agg.count.gold +
                  agg.count.silver +
                  agg.count.chigum +
                  agg.count.other}
              </strong>
              <span className="mx-2 text-[var(--muted)]">·</span>
              매입액 <strong>{formatKRW(agg.totalAmount)}</strong>
            </div>

            <label className="closing-check-label justify-end">
              <input
                type="checkbox"
                checked={ackPurchase}
                disabled={!!existingClosing}
                onChange={(e) => setAckPurchase(e.target.checked)}
              />
              <span className="text-right">
                함량·종류별 중량을 당일 장부·실물과 대조해 확인했습니다.
              </span>
            </label>
          </section>
          </div>

          <section className={workCard}>
            <h2 className={sectionTitle}>3. 비고 · 마감 완료</h2>
            {closingLedgerUnavailable ? (
              <p className="closing-status-warn">
                이 화면에서 시재·매입 대조는 그대로 가능합니다.{" "}
                <span className="font-semibold text-[var(--foreground)]">마감 저장</span>
                만 서버에 일일 마감 테이블이 준비된 뒤 사용할 수 있습니다.
              </p>
            ) : null}
            <textarea
              className="tongsang-field-input min-h-[4rem] resize-y py-2 disabled:opacity-60"
              placeholder="특이사항이 있으면 적어 두세요 (선택)"
              value={note}
              disabled={!!existingClosing}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                className="tongsang-pill tongsang-pill-active px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmit}
                onClick={() => void handleCompleteClose()}
              >
                {existingClosing
                  ? "이미 마감됨"
                  : saving
                    ? "저장 중…"
                    : "마감 완료"}
              </button>
            </div>
            {!existingClosing ? (
              <p className="tongsang-guide-text">
                두 가지 확인에 체크해야 버튼이 활성화됩니다.
                {closingLedgerUnavailable
                  ? " (저장은 DB 설정 완료 후 가능)"
                  : " 저장 시 위 숫자가 그대로 일일 마감 장부에 기록됩니다."}
              </p>
            ) : null}
          </section>

          <section className={workCard}>
            <h2 className={sectionTitle}>최근 마감 기록</h2>
            {historyLoadError ? (
              <p className="tongsang-guide-text">{historyLoadError}</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">아직 기록이 없습니다.</p>
            ) : (
              <div className="closing-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>일자</th>
                      <th>금 g</th>
                      <th>은 g</th>
                      <th>치금 g</th>
                      <th>매입 합</th>
                      <th>마감 시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}>
                        <td className="font-medium">{h.closing_date}</td>
                        <td>{formatWeightG(Number(h.weight_g_gold))}</td>
                        <td>{formatWeightG(Number(h.weight_g_silver))}</td>
                        <td>{formatWeightG(Number(h.weight_g_chigum))}</td>
                        <td>{formatKRW(h.amount_won_total)}</td>
                        <td className="text-[var(--muted)]">
                          {formatDateTime(h.closed_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="tongsang-guide-text">
              매장:{" "}
              <span className="font-semibold text-[var(--foreground)]">
                {branchLabelForId(
                  branches,
                  effectiveBranchIdForUi || branchId,
                )}
              </span>
            </p>
          </section>
        </>
      )}
    </div>
  );
}

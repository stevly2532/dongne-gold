"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { branchLabelForId } from "@/lib/branchLabels";
import {
  formatKRW,
  formatWonInputDisplay,
  parseWonDigitsToNumber,
  purchaseLedgerDateCellParts,
  sanitizeWonInputDigits,
  seoulYmdToUtcRangeIso,
  todayYmdSeoul,
} from "@/lib/format";
import { HelpTooltip } from "@/components/HelpTooltip";
import {
  inventoryCashDepositReceivedWon,
  isCashLikePaymentMethod,
} from "@/lib/inventoryCashDeposit";
import type { Branch } from "@/types/db";

const LEGACY_VAULT_LS_PREFIX = "goldLedger_vaultCash_v1";

type TodayCashFlowRow =
  | {
      kind: "purchase";
      id: string;
      at: string;
      amount: number;
      itemLabel: string;
    }
  | {
      kind: "sale";
      id: string;
      at: string;
      amount: number;
      itemLabel: string;
    };

function inventoryItemLabel(row: {
  name?: string | null;
  product_name?: string | null;
  kind?: string | null;
}): string {
  const name = row.name?.trim();
  if (name) return name;
  const product = row.product_name?.trim();
  if (product) return product;
  return row.kind?.trim() || "—";
}

function legacyVaultStorageKey(branchId: string, ymd: string) {
  return `${LEGACY_VAULT_LS_PREFIX}_${branchId}_${ymd}`;
}

function isMissingVaultTableError(err: {
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

type Props = {
  branchId: string;
  branches: Branch[];
  isAdmin: boolean;
  /** 목록 fetch 중이면 금액 칸 … 표시 */
  listLoading?: boolean;
  /** 조회 기간 — 오늘이 포함될 때만 현금 매입 내역 목록 표시 */
  ledgerFromDate: string;
  ledgerToDate: string;
  /** 부모 load() 후 갱신 트리거 (예: rows.length, loading 토글) */
  refreshKey?: string | number;
  className?: string;
};

export function DailyVaultPanel({
  branchId,
  branches,
  isAdmin,
  listLoading = false,
  ledgerFromDate,
  ledgerToDate,
  refreshKey = 0,
  className = "",
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const localTodayYmd = todayYmdSeoul();

  const [vaultAmountDigits, setVaultAmountDigits] = useState("");
  const [vaultSaveHint, setVaultSaveHint] = useState(false);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultSaving, setVaultSaving] = useState(false);
  const [todayBranchCashPurchaseSum, setTodayBranchCashPurchaseSum] =
    useState(0);
  const [todaySalesCashDepositSum, setTodaySalesCashDepositSum] = useState(0);
  const [todaySalesCashDepositCount, setTodaySalesCashDepositCount] =
    useState(0);
  const [todayCashFlowRows, setTodayCashFlowRows] = useState<
    TodayCashFlowRow[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  const loadVault = useCallback(async () => {
    if (!branchId) {
      setVaultAmountDigits("");
      return;
    }
    const ymd = todayYmdSeoul();
    setVaultLoading(true);
    const { data, error: vaultErr } = await supabase
      .from("branch_vault_snapshots")
      .select("amount_won")
      .eq("branch_id", branchId)
      .eq("vault_date", ymd)
      .maybeSingle();

    if (vaultErr) {
      setVaultLoading(false);
      if (isMissingVaultTableError(vaultErr)) {
        setError(
          "오픈 시재를 다른 기기와 맞추려면 Supabase에서 supabase/migration_branch_vault_snapshots.sql을 실행하세요.",
        );
      }
      setVaultAmountDigits("");
      return;
    }

    if (data != null && data.amount_won != null) {
      const w = Number(data.amount_won);
      if (Number.isFinite(w)) {
        setVaultAmountDigits(sanitizeWonInputDigits(String(Math.round(w))));
        setVaultLoading(false);
        return;
      }
    }

    if (typeof window !== "undefined" && isAdmin) {
      try {
        const raw = localStorage.getItem(legacyVaultStorageKey(branchId, ymd));
        if (raw) {
          const o = JSON.parse(raw) as { amount?: string };
          const digits = sanitizeWonInputDigits(String(o.amount ?? ""));
          const n = parseWonDigitsToNumber(digits);
          if (digits.trim() && n != null && Number.isFinite(n) && n >= 0) {
            const {
              data: { user },
            } = await supabase.auth.getUser();
            if (user) {
              await supabase.from("branch_vault_snapshots").upsert(
                {
                  branch_id: branchId,
                  vault_date: ymd,
                  amount_won: Math.floor(n),
                  updated_by: user.id,
                },
                { onConflict: "branch_id,vault_date" },
              );
              try {
                localStorage.removeItem(legacyVaultStorageKey(branchId, ymd));
              } catch {
                /* ignore */
              }
            }
            setVaultAmountDigits(digits);
            setVaultLoading(false);
            return;
          }
          setVaultAmountDigits(digits);
          setVaultLoading(false);
          return;
        }
      } catch {
        /* ignore */
      }
    }

    setVaultAmountDigits("");
    setVaultLoading(false);
  }, [supabase, branchId, isAdmin]);

  const loadDailyCashFlow = useCallback(async () => {
    if (!branchId) {
      setTodayBranchCashPurchaseSum(0);
      setTodaySalesCashDepositSum(0);
      setTodaySalesCashDepositCount(0);
      setTodayCashFlowRows([]);
      return;
    }
    const ymdSeoul = todayYmdSeoul();
    const { from: todayFromIso, to: todayToIso } =
      seoulYmdToUtcRangeIso(ymdSeoul);

    const [purchaseRes, salesResPrimary] = await Promise.all([
      supabase
        .from("purchases")
        .select("id, purchased_at, total_amount, item_type")
        .eq("branch_id", branchId)
        .eq("payment_method", "현금")
        .gte("purchased_at", todayFromIso)
        .lte("purchased_at", todayToIso)
        .order("purchased_at", { ascending: true }),
      supabase
        .from("inventory_items")
        .select(
          "id, sold_at, sell_price, deposit_won, receivable_won, payment_method, name, product_name, kind",
        )
        .eq("branch_id", branchId)
        .not("sold_at", "is", null)
        .gte("sold_at", todayFromIso)
        .lte("sold_at", todayToIso)
        .order("sold_at", { ascending: true }),
    ]);

    let salesRows: Array<{
      id: string;
      sold_at: string | null;
      sell_price: number | null;
      deposit_won?: number | null;
      receivable_won?: number | null;
      payment_method: string | null;
      name?: string | null;
      product_name?: string | null;
      kind?: string | null;
    }> = [];
    let salesQueryOk = !salesResPrimary.error;

    if (salesQueryOk) {
      salesRows = salesResPrimary.data ?? [];
    } else {
      const m = (salesResPrimary.error!.message ?? "").toLowerCase();
      if (
        m.includes("deposit_won") ||
        salesResPrimary.error!.code === "PGRST204" ||
        m.includes("schema cache")
      ) {
        const fallback = await supabase
          .from("inventory_items")
          .select(
            "id, sold_at, sell_price, receivable_won, payment_method, name, product_name, kind",
          )
          .eq("branch_id", branchId)
          .not("sold_at", "is", null)
          .gte("sold_at", todayFromIso)
          .lte("sold_at", todayToIso)
          .order("sold_at", { ascending: true });
        if (!fallback.error) {
          salesRows = fallback.data ?? [];
          salesQueryOk = true;
        }
      }
    }

    let cashSum = 0;
    const flowRows: TodayCashFlowRow[] = [];
    if (!purchaseRes.error) {
      for (const row of purchaseRes.data ?? []) {
        const amt = Number(row.total_amount);
        if (Number.isFinite(amt)) cashSum += amt;
        flowRows.push({
          kind: "purchase",
          id: row.id,
          at: row.purchased_at,
          amount: Number.isFinite(amt) ? amt : 0,
          itemLabel: row.item_type ?? "—",
        });
      }
    }

    let salesCashSum = 0;
    let salesCashCount = 0;
    if (salesQueryOk) {
      for (const row of salesRows) {
        if (!isCashLikePaymentMethod(row.payment_method)) continue;
        const amt = inventoryCashDepositReceivedWon(row);
        if (amt == null) continue;
        salesCashSum += amt;
        salesCashCount += 1;
        flowRows.push({
          kind: "sale",
          id: row.id,
          at: row.sold_at as string,
          amount: amt,
          itemLabel: inventoryItemLabel(row),
        });
      }
    }

    flowRows.sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );

    setTodayBranchCashPurchaseSum(cashSum);
    setTodaySalesCashDepositSum(salesCashSum);
    setTodaySalesCashDepositCount(salesCashCount);
    setTodayCashFlowRows(flowRows);
  }, [supabase, branchId]);

  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  useEffect(() => {
    void loadDailyCashFlow();
  }, [loadDailyCashFlow, refreshKey]);

  const includesToday =
    ledgerFromDate <= localTodayYmd && localTodayYmd <= ledgerToDate;

  const vaultAmountPreview = parseWonDigitsToNumber(vaultAmountDigits);
  const counterCurrentWon =
    vaultAmountPreview != null
      ? vaultAmountPreview -
        todayBranchCashPurchaseSum +
        todaySalesCashDepositSum
      : null;

  const busy = listLoading || vaultLoading;

  async function saveVaultCashToServer() {
    if (!branchId || !isAdmin) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("로그인이 필요합니다.");
      return;
    }
    const ymd = todayYmdSeoul();
    const n = parseWonDigitsToNumber(vaultAmountDigits);
    const amountWon =
      n != null && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    setVaultSaving(true);
    setError(null);
    const { error: saveErr } = await supabase.from("branch_vault_snapshots").upsert(
      {
        branch_id: branchId,
        vault_date: ymd,
        amount_won: amountWon,
        updated_by: user.id,
      },
      { onConflict: "branch_id,vault_date" },
    );
    setVaultSaving(false);
    if (saveErr) {
      if (isMissingVaultTableError(saveErr)) {
        setError(
          "오픈 시재를 저장하려면 Supabase에서 migration_branch_vault_snapshots.sql을 실행하세요.",
        );
      } else {
        setError(saveErr.message || "시재를 저장하지 못했습니다.");
      }
      return;
    }
    try {
      localStorage.removeItem(legacyVaultStorageKey(branchId, ymd));
    } catch {
      /* ignore */
    }
    setVaultSaveHint(true);
    if (typeof window !== "undefined") {
      window.setTimeout(() => setVaultSaveHint(false), 2000);
    }
    void loadVault();
  }

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col purchase-ledger-work-card p-3 lg:justify-between lg:self-stretch lg:p-3.5 ${className}`.trim()}
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-6 lg:flex-1 lg:justify-between">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="text-lg font-semibold text-[var(--foreground)] lg:text-xl">
              당일 시재
            </h3>
            <HelpTooltip label="당일 시재 도움말">
              {isAdmin
                ? "오픈 시재 저장 후, 오늘·이 매장 현금 매입(출금)과 현금·현영 판매 입금(입금, 미수 건은 받은금액만)을 반영해 카운터 금고 잔액을 봅니다. 카드·통장은 제외."
                : "오픈 시재는 관리자만 변경. 아래는 저장값 기준 오늘 현금 출입 반영 후 카운터 잔액입니다."}
            </HelpTooltip>
          </div>
          <p className="text-xs text-[var(--muted)]">
            기준 {localTodayYmd}
            {branchId ? ` · ${branchLabelForId(branches, branchId)}` : null}
          </p>
        </div>

        {error ? (
          <p className="text-xs text-amount-out">{error}</p>
        ) : null}

        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2 sm:gap-2.5">
            <div className="min-w-0 flex-1 sm:max-w-[15rem]">
              <label className="toss-form-label mb-1 block">
                오픈 시재 금액(원)
                {!isAdmin ? (
                  <span className="ml-1 font-normal text-[var(--muted)]">
                    (조회만)
                  </span>
                ) : null}
              </label>
              <input
                value={formatWonInputDisplay(vaultAmountDigits)}
                onChange={(e) =>
                  setVaultAmountDigits(sanitizeWonInputDigits(e.target.value))
                }
                placeholder="0"
                inputMode="numeric"
                readOnly={!isAdmin}
                disabled={!branchId || vaultLoading || vaultSaving}
                className="toss-input h-9 w-full tabular-nums text-right read-only:cursor-default"
              />
            </div>
            <button
              type="button"
              disabled={!branchId || vaultLoading || vaultSaving || !isAdmin}
              onClick={() => void saveVaultCashToServer()}
              className="toss-btn-primary toss-btn-md w-full shrink-0 disabled:opacity-50 sm:w-auto"
            >
              {vaultSaving ? "저장 중…" : "저장"}
            </button>
            {vaultSaveHint && isAdmin ? (
              <span className="text-positive pb-1.5 text-sm">저장했습니다.</span>
            ) : null}
          </div>

          <div className="border-t border-[var(--border)] pt-3">
            <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--border)] pb-1.5">
              <span className="text-sm font-semibold text-[var(--foreground)]">
                카운터 시재
              </span>
              <span className="text-xl font-bold tabular-nums leading-none text-[var(--foreground)] sm:text-2xl">
                {vaultAmountPreview == null
                  ? "—"
                  : !branchId
                    ? "—"
                    : busy
                      ? "…"
                      : formatKRW(counterCurrentWon ?? 0)}
              </span>
            </div>
            <p className="mb-1 text-xs font-medium text-[var(--muted)]">
              현금 출납 (요약)
            </p>
            <table className="w-full border-collapse text-left text-sm tabular-nums">
              <tbody className="text-[var(--foreground)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="py-0.5 pr-2 text-left font-normal text-[var(--muted)]">
                    오픈 시재
                  </th>
                  <td className="py-0.5 text-right font-medium text-[var(--foreground)]">
                    {vaultAmountPreview == null || !branchId
                      ? "—"
                      : vaultLoading
                        ? "…"
                        : formatKRW(vaultAmountPreview)}
                  </td>
                </tr>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-0.5 pr-2 text-left font-normal text-[var(--muted)]">
                    현금매입 지급
                    {!busy && branchId ? (
                      <span className="ml-0.5 text-[var(--muted)]">
                        (
                        {
                          todayCashFlowRows.filter((r) => r.kind === "purchase")
                            .length
                        }
                        건)
                      </span>
                    ) : null}
                  </th>
                  <td className="py-0.5 text-right font-medium text-amount-out">
                    {!branchId || busy
                      ? "—"
                      : `−${formatKRW(todayBranchCashPurchaseSum)}`}
                  </td>
                </tr>
                <tr>
                  <th className="py-0.5 pr-2 text-left font-normal text-[var(--muted)]">
                    판매 입금시재
                    {!busy && branchId ? (
                      <span className="ml-0.5 text-[var(--muted)]">
                        ({todaySalesCashDepositCount}건·현금·현영)
                      </span>
                    ) : null}
                  </th>
                  <td className="py-0.5 text-right font-medium text-positive">
                    {!branchId || busy
                      ? "—"
                      : todaySalesCashDepositSum > 0
                        ? `+${formatKRW(todaySalesCashDepositSum)}`
                        : formatKRW(0)}
                  </td>
                </tr>
              </tbody>
            </table>

            {includesToday ? (
              <>
                <p className="mb-1 mt-2 text-xs font-medium text-[var(--muted)]">
                  현금 입출금 내역
                </p>
                {todayCashFlowRows.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">
                    당일 현금 입출금 없음
                  </p>
                ) : (
                  <div className="max-h-[10rem] w-full overflow-y-auto overscroll-contain rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--surface-subtle)] [scrollbar-gutter:stable]">
                    <table className="w-full table-fixed border-collapse text-center text-xs tabular-nums [&_td]:px-1.5 [&_td]:py-1.5 [&_th]:px-1.5 [&_th]:py-1.5">
                      <colgroup>
                        <col style={{ width: "14%" }} />
                        <col style={{ width: "28%" }} />
                        <col style={{ width: "28%" }} />
                        <col style={{ width: "30%" }} />
                      </colgroup>
                      <thead className="toss-table-head sticky top-0 z-[1] text-[11px] font-medium">
                        <tr>
                          <th>시각</th>
                          <th>출금</th>
                          <th>입금</th>
                          <th>품목</th>
                        </tr>
                      </thead>
                      <tbody className="text-[var(--foreground)]">
                        {todayCashFlowRows.map((row) => {
                          const parts = purchaseLedgerDateCellParts(row.at);
                          const t = parts.timeHm ?? "—";
                          return (
                            <tr
                              key={`${row.kind}-${row.id}`}
                              className="border-t border-[var(--border)]"
                            >
                              <td className="whitespace-nowrap text-[var(--foreground)]">
                                {t}
                              </td>
                              <td className="whitespace-nowrap font-medium text-amount-out">
                                {row.kind === "purchase"
                                  ? `−${formatKRW(row.amount)}`
                                  : "—"}
                              </td>
                              <td className="whitespace-nowrap font-medium text-positive">
                                {row.kind === "sale"
                                  ? `+${formatKRW(row.amount)}`
                                  : "—"}
                              </td>
                              <td className="max-w-0 truncate text-[var(--foreground)]">
                                {row.itemLabel}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-1.5 text-xs leading-snug text-[var(--muted)]">
                내역 목록은 조회 기간에 오늘({localTodayYmd})이 포함될 때
                표시됩니다.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

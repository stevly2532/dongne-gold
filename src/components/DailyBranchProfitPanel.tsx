"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatKRW, seoulYmdToUtcRangeIso, todayYmdSeoul } from "@/lib/format";
import { HelpTooltip } from "@/components/HelpTooltip";
import { salesLedgerTableDisplayedMarginWon } from "@/lib/salesLedgerTableMargin";
import {
  JONGRO_QUOTE_SCOPE_GOLD,
  JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER,
  JONGRO_QUOTE_SCOPE_SILVER,
  type InventoryItem,
  type Purchase,
} from "@/types/db";

type QuoteRow = {
  quote_date: string;
  quote_scope: string | null;
  price_per_don: number;
};

function quoteMapFromRows(rows: QuoteRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const q of rows) {
    const scope = q.quote_scope ?? JONGRO_QUOTE_SCOPE_GOLD;
    const k = `${q.quote_date}|${scope}`;
    if (q.price_per_don != null && Number.isFinite(Number(q.price_per_don))) {
      m.set(k, Number(q.price_per_don));
    }
  }
  return m;
}

function sumTodayPurchaseMarginWon(purchases: Purchase[]): number {
  return purchases.reduce((a, p) => {
    if (p.item_type !== "금") return a;
    const m = p.margin_amount;
    if (m == null || !Number.isFinite(Number(m))) return a;
    return a + Math.round(Number(m));
  }, 0);
}

function sumTodaySalesMarginWon(
  items: InventoryItem[],
  quoteMap: Map<string, number>,
): number {
  let sum = 0;
  const laborEdits: Record<string, string> = {};
  const jongroQuoteEdits: Record<string, string> = {};
  for (const r of items) {
    const m = salesLedgerTableDisplayedMarginWon(
      r,
      quoteMap,
      jongroQuoteEdits,
      laborEdits,
    );
    if (m != null) sum += m;
  }
  return sum;
}

type Props = {
  branchId: string;
  reloadToken?: number;
  variant?: "default" | "purchase-ledger";
};

export function DailyBranchProfitPanel({
  branchId,
  reloadToken = 0,
  variant = "default",
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);
  const [purchaseProfit, setPurchaseProfit] = useState<number | null>(null);
  const [salesProfit, setSalesProfit] = useState<number | null>(null);
  const [ymd, setYmd] = useState(() => todayYmdSeoul());

  const load = useCallback(async () => {
    const y = todayYmdSeoul();
    setYmd(y);
    if (!branchId) {
      setPurchaseProfit(null);
      setSalesProfit(null);
      return;
    }
    setLoading(true);
    const { from, to } = seoulYmdToUtcRangeIso(y);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPurchaseProfit(null);
      setSalesProfit(null);
      setLoading(false);
      return;
    }

    const [purRes, invRes, quoteRes] = await Promise.all([
      supabase
        .from("purchases")
        .select("*")
        .eq("branch_id", branchId)
        .gte("purchased_at", from)
        .lte("purchased_at", to),
      supabase
        .from("inventory_items")
        .select("*")
        .eq("branch_id", branchId)
        .gte("sold_at", from)
        .lte("sold_at", to),
      supabase
        .from("jongro_daily_quotes")
        .select("quote_date, quote_scope, price_per_don")
        .eq("branch_id", branchId)
        .eq("quote_date", y)
        .in("quote_scope", [
          JONGRO_QUOTE_SCOPE_GOLD,
          JONGRO_QUOTE_SCOPE_GOLD_SALES_LEDGER,
          JONGRO_QUOTE_SCOPE_SILVER,
        ]),
    ]);

    const purchases = (purRes.data ?? []) as Purchase[];
    const items = (invRes.data ?? []) as InventoryItem[];
    const quoteRows = (quoteRes.data ?? []) as QuoteRow[];
    const quoteMap = quoteMapFromRows(quoteRows);

    setPurchaseProfit(sumTodayPurchaseMarginWon(purchases));
    setSalesProfit(sumTodaySalesMarginWon(items, quoteMap));
    setLoading(false);
  }, [supabase, branchId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const total =
    purchaseProfit != null && salesProfit != null
      ? purchaseProfit + salesProfit
      : null;

  const isPurchaseLedger = variant === "purchase-ledger";

  if (!branchId) {
    return (
      <div
        className={
          isPurchaseLedger
            ? "purchase-ledger-profit-panel purchase-ledger-profit-panel-empty text-xs text-[#8b95a1]"
            : "mt-3 rounded-lg border border-dashed border-[var(--border)] bg-stone-50/60 px-3 py-2.5 text-xs text-[var(--muted)]"
        }
      >
        지점을 선택하면 당일 매입·매출 이익 합계를 표시합니다.
      </div>
    );
  }

  if (isPurchaseLedger) {
    return (
      <div className="purchase-ledger-profit-panel purchase-ledger-profit-panel-fill min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="purchase-ledger-section-label shrink-0">당일 이익</p>
            <HelpTooltip label="당일 이익 도움말">
              당일 금 매입 마진(월매입장부 ‘오늘 이익금’)과 매출 마진을 더한 값입니다.
            </HelpTooltip>
          </div>
          <p className="purchase-ledger-profit-panel-date shrink-0 tabular-nums">{ymd}</p>
        </div>
        <div className="purchase-ledger-profit-row mt-3">
          <div className="purchase-ledger-profit-sub purchase-ledger-profit-sub-secondary">
            <p className="purchase-ledger-profit-sub-label">오늘 매입 이익</p>
            <p className="purchase-ledger-profit-amount">
              {loading ? "…" : formatKRW(purchaseProfit ?? 0)}
            </p>
          </div>
          <div className="purchase-ledger-profit-sub purchase-ledger-profit-sub-secondary">
            <p className="purchase-ledger-profit-sub-label">오늘 매출 이익</p>
            <p className="purchase-ledger-profit-amount">
              {loading ? "…" : formatKRW(salesProfit ?? 0)}
            </p>
          </div>
          <div className="purchase-ledger-profit-sub purchase-ledger-profit-sub-total">
            <p className="purchase-ledger-profit-sub-label">일이익 합계</p>
            <p className="purchase-ledger-profit-total">
              {loading ? "…" : formatKRW(total ?? 0)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 toss-muted-panel px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--foreground)]">당일 이익</p>
        <p className="text-[11px] font-medium tabular-nums text-[var(--muted)]">
          기준일(한국) {ymd}
        </p>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">
        당일 금 매입 마진(월매입장부 ‘오늘 이익금’)과 매출 마진을 더한 값입니다. 매출
        마진은 저장된 종로 일별 시세(DB)로 계산합니다.
      </p>
      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-md bg-[var(--surface-subtle)] px-2.5 py-2">
          <p className="text-[11px] font-medium text-[var(--muted)]">오늘 매입 이익</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums text-[var(--foreground)]">
            {loading ? "…" : formatKRW(purchaseProfit ?? 0)}
          </p>
        </div>
        <div className="rounded-md bg-[var(--surface-subtle)] px-2.5 py-2">
          <p className="text-[11px] font-medium text-[var(--muted)]">오늘 매출 이익</p>
          <p className="mt-0.5 text-base font-semibold tabular-nums text-[var(--foreground)]">
            {loading ? "…" : formatKRW(salesProfit ?? 0)}
          </p>
        </div>
        <div className="rounded-md bg-[var(--card)] px-2.5 py-2">
          <p className="text-[11px] font-medium text-[var(--muted)]">일이익 합계</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-[var(--foreground)]">
            {loading ? "…" : formatKRW(total ?? 0)}
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { renameFirstBonjeomInDb } from "@/lib/branchLabels";
import { formatKRW, todayYmdSeoul, formatLedgerYearLabel } from "@/lib/format";
import { salesLedgerTableDisplayedMarginWon } from "@/lib/salesLedgerTableMargin";
import {
  type Branch,
  type InventoryItem,
  type Profile,
  type Purchase,
  JONGRO_QUOTE_SCOPE_GOLD,
} from "@/types/db";

const BONJEOM = "\uBCF8\uC810";
const HYANGNAM = "\uD5A5\uB0A8\uC810";

function formatBranchCreatedAt(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** 매입·장부 등과 같이 목록에서 본점을 향남점으로 부른다. */
function shopListTitle(name: string): string {
  return name === BONJEOM ? HYANGNAM : name;
}

function monthDateRange(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(month)}-01`;
  const end = new Date(year, month, 0);
  const to = `${year}-${pad(month)}-${pad(end.getDate())}`;
  return { from, to };
}

function seoulMonthRangeFromTodayYmd(): { from: string; to: string; label: string } {
  const ymd = todayYmdSeoul();
  const [yStr, mStr] = ymd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const { from, to } = monthDateRange(y, m);
  return { from, to, label: `${formatLedgerYearLabel(y)} ${m}월` };
}

export default function BranchesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [shopStatsByBranch, setShopStatsByBranch] = useState<
    Record<
      string,
      {
        purchaseMargin: number;
        salesMargin: number;
      }
    >
  >({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsLabel, setStatsLabel] = useState("");
  const [statsError, setStatsError] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";

  const loadShopStats = useCallback(
    async (branchList: Branch[]) => {
      const targets = branchList.filter((b) => shopListTitle(b.name) === HYANGNAM);
      if (targets.length === 0) {
        setShopStatsByBranch({});
        setStatsLabel("");
        setStatsError(null);
        return;
      }
      const { from, to, label } = seoulMonthRangeFromTodayYmd();
      setStatsLabel(label);
      const fromIso = new Date(`${from}T00:00:00+09:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59.999+09:00`).toISOString();
      const ids = targets.map((b) => b.id);

      setStatsLoading(true);
      setStatsError(null);
      const [purRes, invRes, qRes] = await Promise.all([
        supabase
          .from("purchases")
          .select("branch_id, margin_amount, purchased_at")
          .in("branch_id", ids)
          .eq("item_type", "금")
          .gte("purchased_at", fromIso)
          .lte("purchased_at", toIso),
        supabase
          .from("inventory_items")
          .select("*")
          .in("branch_id", ids)
          .gte("sold_at", fromIso)
          .lte("sold_at", toIso),
        supabase
          .from("jongro_daily_quotes")
          .select("branch_id, quote_date, quote_scope, price_per_don")
          .in("branch_id", ids)
          .gte("quote_date", from)
          .lte("quote_date", to),
      ]);
      setStatsLoading(false);

      const errMsg =
        purRes.error?.message ??
        invRes.error?.message ??
        qRes.error?.message ??
        null;
      if (errMsg) {
        setStatsError(errMsg);
        return;
      }

      const purchases = (purRes.data ?? []) as Pick<
        Purchase,
        "branch_id" | "margin_amount"
      >[];
      const inv = (invRes.data ?? []) as InventoryItem[];
      const quotes = (qRes.data ?? []) as Array<{
        branch_id: string;
        quote_date: string;
        quote_scope: string | null;
        price_per_don: number;
      }>;

      const quoteMapsByBranch = new Map<string, Map<string, number>>();
      for (const q of quotes) {
        let inner = quoteMapsByBranch.get(q.branch_id);
        if (!inner) {
          inner = new Map();
          quoteMapsByBranch.set(q.branch_id, inner);
        }
        const scope = q.quote_scope ?? JONGRO_QUOTE_SCOPE_GOLD;
        const k = `${q.quote_date}|${scope}`;
        if (q.price_per_don != null && Number.isFinite(Number(q.price_per_don))) {
          inner.set(k, Math.round(Number(q.price_per_don)));
        }
      }

      const next: Record<
        string,
        {
          purchaseMargin: number;
          salesMargin: number;
        }
      > = {};
      for (const b of targets) {
        let purchaseMargin = 0;
        for (const p of purchases) {
          if (p.branch_id !== b.id) continue;
          // Safety: branches stats should reflect 월매입장부(금)만. 은/치금은 각 장부에서 확인.
          // (Query already filters item_type="금", but keep intent explicit.)
          const m = p.margin_amount;
          if (m != null && Number.isFinite(Number(m))) {
            purchaseMargin += Math.round(Number(m));
          }
        }
        const rowsForB = inv.filter((r) => r.branch_id === b.id);
        const qmap = quoteMapsByBranch.get(b.id) ?? new Map<string, number>();
        let salesMargin = 0;
        for (const r of rowsForB) {
          const m = salesLedgerTableDisplayedMarginWon(r, qmap, {}, {});
          if (m != null) salesMargin += m;
        }
        next[b.id] = {
          purchaseMargin,
          salesMargin,
        };
      }
      setShopStatsByBranch(next);
    },
    [supabase],
  );

  async function refresh() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, role, branch_id, full_name")
      .eq("id", user.id)
      .maybeSingle();
    setProfile(prof as Profile);

    const { data: br, error: be } = await supabase
      .from("branches")
      .select("id, name, created_at")
      .order("name");
    if (be) setError(be.message);
    else {
      let list = (br ?? []) as Branch[];
      if ((prof as Profile)?.role === "admin" && list.length > 0) {
        list = await renameFirstBonjeomInDb(supabase, list);
      }
      setBranches(list);
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [supabase]);

  useEffect(() => {
    if (!isAdmin || branches.length === 0) return;
    void loadShopStats(branches);
  }, [branches, isAdmin, loadShopStats]);

  async function addBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    const { error: ie } = await supabase.from("branches").insert({ name: name.trim() });
    if (ie) {
      setError(ie.message);
      return;
    }
    setName("");
    await refresh();
  }

  async function saveBranchName(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) {
      setError("지점 이름을 입력하세요.");
      return;
    }
    setSavingRename(true);
    setError(null);
    const { error: ue } = await supabase
      .from("branches")
      .update({ name: trimmed })
      .eq("id", id);
    setSavingRename(false);
    if (ue) {
      setError(ue.message);
      return;
    }
    setEditingId(null);
    setEditName("");
    await refresh();
  }

  async function removeBranch(id: string) {
    if (
      !confirm(
        "이 지점을 삭제할까요? 매입 등 데이터가 있으면 삭제가 막힐 수 있습니다.",
      )
    )
      return;
    const { error: de } = await supabase.from("branches").delete().eq("id", id);
    if (de) {
      setError(de.message);
      return;
    }
    await refresh();
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-5">
        <p className="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-5">
        <div className="purchase-ledger-work-card p-6 text-[var(--foreground)]">
          Admins only.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-3 sm:px-4 lg:px-5">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">지점</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          지점을 추가한 뒤 「직원」에서 매장을 배정하세요. 이름이 같은 지점은
          등록 시각·ID로 구분한 뒤, 쓰지 않을 쪽만 이름을 바꾸면 됩니다.
        </p>
      </div>

      {error ? (
        <div className="toss-alert-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={(e) => void addBranch(e)}
        className="flex flex-wrap items-end gap-3 purchase-ledger-work-card p-4"
      >
        <div className="min-w-[200px] flex-1">
          <label className="block text-xs font-medium text-[var(--muted)]">지점 이름</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            placeholder="예: 향남점, XX점"
          />
        </div>
        <button
          type="submit"
          className="toss-btn-primary rounded-lg px-4 py-2 text-sm"
        >
          추가
        </button>
      </form>

      <ul className="divide-y divide-stone-100 purchase-ledger-work-card">
        {branches.length === 0 ? (
          <li className="px-4 py-8 text-center text-[var(--muted)]">No branches yet.</li>
        ) : (
          branches.map((b) => (
            <li
              key={b.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                {editingId === b.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="min-w-[10rem] flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                      placeholder="새 지점 이름"
                      disabled={savingRename}
                    />
                    <button
                      type="button"
                      disabled={savingRename}
                      onClick={() => void saveBranchName(b.id)}
                      className="toss-btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      disabled={savingRename}
                      onClick={() => {
                        setEditingId(null);
                        setEditName("");
                      }}
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-gray-50 dark:bg-gray-800/60"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-medium text-[var(--foreground)]">
                      {shopListTitle(b.name)}
                    </span>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      등록: {formatBranchCreatedAt(b.created_at)} · ID{" "}
                      <code className="rounded bg-stone-100 px-1">{b.id.slice(0, 8)}…</code>
                    </p>
                    {shopListTitle(b.name) === HYANGNAM ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-[var(--foreground)]">
                        {statsError ? (
                          <span className="text-rose-700">실적: {statsError}</span>
                        ) : statsLoading ? (
                          <span className="text-[var(--muted)]">실적 불러오는 중…</span>
                        ) : (
                          <>
                            <span className="font-medium text-[var(--foreground)]">
                              {statsLabel}
                            </span>
                            {" · 금 매입 이익금 "}
                            <span className="tabular-nums">
                              {formatKRW(shopStatsByBranch[b.id]?.purchaseMargin ?? 0)}
                            </span>
                            {" · 매출 이익금 "}
                            <span className="tabular-nums">
                              {formatKRW(shopStatsByBranch[b.id]?.salesMargin ?? 0)}
                            </span>
                            {" · "}
                            <span className="font-semibold text-[var(--foreground)]">
                              합계 이익금
                            </span>{" "}
                            <span className="font-bold tabular-nums text-amber-900 dark:text-amber-300">
                              {formatKRW(
                                (shopStatsByBranch[b.id]?.purchaseMargin ?? 0) +
                                  (shopStatsByBranch[b.id]?.salesMargin ?? 0),
                              )}
                            </span>
                          </>
                        )}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {editingId !== b.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(b.id);
                      setEditName(b.name);
                    }}
                    className="rounded-lg border border-amber-300/80 bg-amber-50 px-2.5 py-1 text-sm font-semibold text-amber-950 hover:bg-amber-100 dark:border-amber-500/45 dark:bg-amber-950/35 dark:text-amber-200 dark:hover:bg-amber-950/55"
                  >
                    이름 변경
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void removeBranch(b.id)}
                  className="toss-link-danger text-sm hover:underline"
                >
                  삭제
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

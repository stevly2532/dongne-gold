"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { branchesForShopSelect } from "@/lib/branchLabels";
import type { Branch, Profile } from "@/types/db";

type ProfileRow = Profile;

/** 표에 보여줄 표시명. 풀네임 > 이메일 > id 앞 8자 순. */
function staffDisplayName(p: ProfileRow): string {
  const full = (p.full_name ?? "").trim();
  if (full) return full;
  const email = (p.email ?? "").trim();
  if (email) return email;
  return p.id.slice(0, 8);
}

export default function StaffPage() {
  const supabase = useMemo(() => createClient(), []);
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 직원별 드롭다운 선택값 (저장 전). 키 없으면 서버 `branch_id` 표시. */
  const [draftBranchByStaff, setDraftBranchByStaff] = useState<
    Record<string, string>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  async function refresh() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: prof } = await supabase
      .from("profiles")
      .select("id, role, branch_id, full_name, email")
      .eq("id", user.id)
      .maybeSingle();
    setMe(prof as Profile);

    const { data: br } = await supabase
      .from("branches")
      .select("id, name, created_at")
      .order("name");
    setBranches((br ?? []) as Branch[]);

    if ((prof as Profile)?.role === "admin") {
      const { data: plist, error: pe } = await supabase
        .from("profiles")
        .select("id, role, branch_id, full_name, email")
        .order("full_name", { nullsFirst: false })
        .order("email");
      if (pe) setError(pe.message);
      else setProfiles((plist ?? []) as ProfileRow[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, [supabase]);

  const isAdmin = me?.role === "admin";

  function draftValue(p: ProfileRow): string {
    if (p.role !== "staff") return "";
    if (Object.prototype.hasOwnProperty.call(draftBranchByStaff, p.id)) {
      return draftBranchByStaff[p.id];
    }
    return p.branch_id ?? "";
  }

  function isDirty(p: ProfileRow): boolean {
    if (p.role !== "staff") return false;
    const d = draftValue(p);
    const saved = p.branch_id ?? "";
    return d !== saved;
  }

  async function saveStaffBranch(p: ProfileRow) {
    if (p.role !== "staff") return;
    setSavingId(p.id);
    setError(null);
    setSuccessId(null);
    const raw = draftValue(p);
    const branchId = raw.trim() === "" ? null : raw;
    const { error: ue } = await supabase
      .from("profiles")
      .update({ branch_id: branchId })
      .eq("id", p.id);
    setSavingId(null);
    if (ue) {
      setError(ue.message);
      return;
    }
    setDraftBranchByStaff((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    setSuccessId(p.id);
    if (typeof window !== "undefined") {
      window.setTimeout(() => setSuccessId((id) => (id === p.id ? null : id)), 2000);
    }
    await refresh();
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-5">
        <p className="text-[var(--muted)]">불러오는 중…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-5">
        <div className="purchase-ledger-work-card p-6 text-[var(--foreground)]">
          관리자만 이용할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-3 sm:px-4 lg:px-5">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">직원 · 소속 매장</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          직원의 매장을 선택한 뒤 <strong className="font-medium">저장</strong>을
          눌러 반영합니다. (저장 전에는 DB에 적용되지 않습니다.) 이름이 비어
          있으면 이메일이 식별자로 표시됩니다.
        </p>
      </div>

      {error ? (
        <div className="toss-alert-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto overflow-hidden purchase-ledger-work-card">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs font-medium text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">이름</th>
              <th className="px-3 py-2">이메일</th>
              <th className="px-3 py-2">역할</th>
              <th className="px-3 py-2">소속 매장</th>
              <th className="px-3 py-2 w-[1%] whitespace-nowrap">저장</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {profiles.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-medium text-[var(--foreground)]">
                  {staffDisplayName(p)}
                </td>
                <td className="px-3 py-2 text-[var(--foreground)]">
                  {p.email ? (
                    <span className="break-all">{p.email}</span>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-[var(--foreground)]">
                  {p.role === "admin" ? "관리자" : "직원"}
                </td>
                <td className="px-3 py-2">
                  {p.role === "admin" ? (
                    <span className="text-[var(--muted)]">전 매장</span>
                  ) : (
                    <select
                      value={draftValue(p)}
                      onChange={(e) =>
                        setDraftBranchByStaff((prev) => ({
                          ...prev,
                          [p.id]: e.target.value,
                        }))
                      }
                      disabled={savingId === p.id}
                      className="max-w-full min-w-[10rem] rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm disabled:bg-stone-100"
                    >
                      <option value="">미배정</option>
                      {branchesForShopSelect(branches).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {p.role === "admin" ? (
                    <span className="text-[var(--muted)]">—</span>
                  ) : (
                    <div className="flex flex-row flex-nowrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!isDirty(p) || savingId === p.id}
                        onClick={() => void saveStaffBranch(p)}
                        className="toss-btn-primary shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingId === p.id ? "저장 중…" : "저장"}
                      </button>
                      {successId === p.id ? (
                        <span className="shrink-0 whitespace-nowrap text-xs text-positive">
                          저장됨
                        </span>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

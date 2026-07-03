import type { SupabaseClient } from "@supabase/supabase-js";
import type { Branch } from "@/types/db";
import { BRANCH_NAMES_HIDDEN_FROM_SHOP_SELECT } from "@/config/app";

const BONJEOM = "\uBCF8\uC810";
const HYANGNAM = "\uD5A5\uB0A8\uC810";

function isHiddenFromShopSelectByName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return BRANCH_NAMES_HIDDEN_FROM_SHOP_SELECT.some(
    (h) => h.trim().toLowerCase() === n,
  );
}

/** 매입·장부·일일마감 등 매장 선택용 (숨김 이름 제외). 라벨 표시용은 전체 branches 유지. */
export function branchesForShopSelect(branches: Branch[]): Branch[] {
  return branches.filter((b) => !isHiddenFromShopSelectByName(b.name));
}

export function branchSelectRowsForShop(branches: Branch[]): {
  id: string;
  label: string;
}[] {
  return branchSelectRows(branchesForShopSelect(branches));
}

/** 관리자 기본 매장: 선택 가능한 지점 중 첫 번째 id */
export function firstShopSelectableBranchId(branches: Branch[]): string {
  return branchesForShopSelect(branches)[0]?.id ?? "";
}

export function branchSelectRows(branches: Branch[]): { id: string; label: string }[] {
  const bonjeoms = branches
    .filter((b) => b.name === BONJEOM)
    .sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  const relabelId = bonjeoms.length >= 2 ? bonjeoms[0].id : null;
  return branches.map((b) => ({
    id: b.id,
    label: b.name === BONJEOM && b.id === relabelId ? HYANGNAM : b.name,
  }));
}

export function branchLabelsById(branches: Branch[]): Map<string, string> {
  return new Map(branchSelectRows(branches).map((r) => [r.id, r.label]));
}

export function branchLabelForId(
  branches: Branch[],
  branchId: string | null | undefined,
): string {
  if (!branchId) return HYANGNAM;
  return branchLabelsById(branches).get(branchId) ?? HYANGNAM;
}

export async function renameFirstBonjeomInDb(
  supabase: SupabaseClient,
  branches: Branch[],
): Promise<Branch[]> {
  const bonjeoms = branches.filter((b) => b.name === BONJEOM);
  if (bonjeoms.length <= 1) return branches;
  const target = [...bonjeoms].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )[0];
  const { error } = await supabase
    .from("branches")
    .update({ name: HYANGNAM })
    .eq("id", target.id);
  if (error) return branches;
  return branches.map((b) =>
    b.id === target.id ? { ...b, name: HYANGNAM } : b,
  );
}
/**
 * true = hide Branches/Staff nav (single-shop UI).
 * false = show 지점·직원 links for admin (multi-branch / staff assignment).
 */
export const SOLO_SHOP_MODE = false;

/** 사장님 계정 — profiles 조회 실패 시에도 관리자·동탄점으로 처리 */
export const SHOP_OWNER_EMAILS = ["dngbb1221@naver.com"] as const;

/** DB bootstrap 후 동탄점 id (profiles/branches 조회 실패 시 fallback) */
export const DEFAULT_BRANCH = {
  id: "ea4802d6-0fdf-4fba-a839-6e42f4498dba",
  name: "동탄점",
} as const;

/**
 * 매장(지점) 선택 드롭다운에서 빼고 싶은 지점 이름. 오픈 예정 등.
 * 대소문자 무시, 앞뒤 공백 무시. 지점 관리(/branches) 목록에는 그대로 표시.
 */
export const BRANCH_NAMES_HIDDEN_FROM_SHOP_SELECT: readonly string[] = [
  "xx점",
];

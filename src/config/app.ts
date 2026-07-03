/**
 * true = hide Branches/Staff nav (single-shop UI).
 * false = show 지점·직원 links for admin (multi-branch / staff assignment).
 */
export const SOLO_SHOP_MODE = false;

/**
 * 매장(지점) 선택 드롭다운에서 빼고 싶은 지점 이름. 오픈 예정 등.
 * 대소문자 무시, 앞뒤 공백 무시. 지점 관리(/branches) 목록에는 그대로 표시.
 */
export const BRANCH_NAMES_HIDDEN_FROM_SHOP_SELECT: readonly string[] = [
  "xx점",
];

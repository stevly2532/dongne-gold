/** 현금·현영 시재 반영용 매출 행 (받은금액 계산) */
export type InventoryCashDepositRow = {
  sell_price?: number | null;
  receivable_won?: number | null;
  deposit_won?: number | null;
  payment_method?: string | null;
};

export function isCashLikePaymentMethod(pm: string | null | undefined): boolean {
  const t = String(pm ?? "").trim();
  return t === "현금" || t === "현영";
}

/**
 * 카운터 시재·일일마감에 넣을 실제 입금액.
 * 미수가 있으면 받은금액(deposit_won, 없으면 판매가−미수), 완불이면 판매가 전액.
 */
export function inventoryCashDepositReceivedWon(
  row: InventoryCashDepositRow,
): number | null {
  const sell = row.sell_price != null ? Number(row.sell_price) : NaN;
  if (!Number.isFinite(sell)) return null;
  const sellRounded = Math.round(sell);

  const recv = row.receivable_won != null ? Number(row.receivable_won) : NaN;
  if (Number.isFinite(recv) && recv > 0) {
    const deposit = row.deposit_won != null ? Number(row.deposit_won) : NaN;
    if (Number.isFinite(deposit)) return Math.max(0, Math.round(deposit));
    return Math.max(0, sellRounded - Math.round(recv));
  }

  return sellRounded;
}

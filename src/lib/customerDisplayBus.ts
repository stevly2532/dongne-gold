/** 고객용 디스플레이(둘째 모니터) ↔ 매입등록 탭 동기화 — 같은 PC·같은 브라우저 BroadcastChannel */

export const CUSTOMER_DISPLAY_CHANNEL = "gold-ledger-customer-display-v1";

export const CUSTOMER_DISPLAY_COMPLETE_MS = 15_000;
export const CUSTOMER_DISPLAY_HEARTBEAT_STALE_MS = 10_000;

export type CustomerDisplayLine = {
  purityLabel: string;
  weightG: string | null;
  weightDon: string | null;
  amountWon: number | null;
};

export type CustomerDisplayPayload = {
  itemType: string;
  /** 단일 명세(첫 행) 호환 필드 — 항상 첫 행 값과 동일하게 유지 */
  purityLabel: string;
  weightG: string | null;
  weightDon: string | null;
  amountWon: number | null;
  /** 한 거래의 여러 명세(함량별 줄 추가). 비어있으면 단일 명세로 간주. */
  lines?: CustomerDisplayLine[];
  /** lines 전체 합계(원). 단일 명세면 amountWon과 동일. */
  totalWon?: number | null;
};

export type CustomerDisplayMessage =
  | { type: "heartbeat"; branchName?: string; at: number }
  | { type: "draft"; payload: CustomerDisplayPayload | null; at: number }
  | { type: "saved"; payload: CustomerDisplayPayload; at: number }
  | { type: "idle"; at: number };

function channel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  return new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
}

export function postCustomerDisplayMessage(msg: CustomerDisplayMessage): void {
  const ch = channel();
  if (!ch) return;
  ch.postMessage(msg);
  ch.close();
}

export function subscribeCustomerDisplay(
  handler: (msg: CustomerDisplayMessage) => void,
): () => void {
  const ch = channel();
  if (!ch) return () => {};
  const onMessage = (ev: MessageEvent<CustomerDisplayMessage>) => {
    if (ev.data && typeof ev.data === "object" && "type" in ev.data) {
      handler(ev.data);
    }
  };
  ch.addEventListener("message", onMessage);
  return () => {
    ch.removeEventListener("message", onMessage);
    ch.close();
  };
}

function isCustomerDisplayLineEmpty(l: CustomerDisplayLine): boolean {
  const hasWeight =
    l.weightG != null && l.weightG.trim() !== "" && l.weightG !== "—";
  const hasAmount =
    l.amountWon != null && Number.isFinite(l.amountWon) && l.amountWon > 0;
  const hasPurity = l.purityLabel.trim() !== "" && l.purityLabel !== "—";
  return !hasWeight && !hasAmount && !hasPurity;
}

export function isCustomerDisplayPayloadEmpty(
  p: CustomerDisplayPayload | null,
): boolean {
  if (!p) return true;
  /** 다중 명세 전송 시 — 한 줄이라도 의미 있는 값이 있으면 표시 */
  if (p.lines && p.lines.length > 0) {
    return p.lines.every(isCustomerDisplayLineEmpty);
  }
  return isCustomerDisplayLineEmpty({
    purityLabel: p.purityLabel,
    weightG: p.weightG,
    weightDon: p.weightDon,
    amountWon: p.amountWon,
  });
}

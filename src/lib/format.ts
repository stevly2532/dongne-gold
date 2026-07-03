export function formatKRW(n: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Keep digits only for won input state (max ~15 digits). */
export function sanitizeWonInputDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 15);
}

export function formatWonInputDisplay(digits: string): string {
  if (!digits) return "";
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("ko-KR");
}

export function parseWonDigitsToNumber(digits: string): number | null {
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 100원 미만을 내림(절사). 반올림 없음.
 */
export function floorWonTo100(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.floor(n / 100) * 100;
}

/**
 * 1,000원 미만을 내림(절사). 반올림 없음.
 * 중량·시세 등으로 나온 매입 합계를 `100,100`처럼 보이지 않게 `100,000` 단위로 맞출 때 사용.
 */
export function floorWonTo1000(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.floor(n / 1000) * 1000;
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Purchase ledger: date only (registration / purchased_at). */
export function formatPurchaseLedgerDate(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(iso));
}

/** 매출내역 등: YY.MM.DD (열 너비 절약). */
export function formatSalesLedgerDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(d.getFullYear() % 100)}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

/** 장부 날짜 셀: 날짜 + (엑셀 등 날짜-only 타임스탬프가 아니면) 시:분 */
export function purchaseLedgerDateCellParts(iso: string): {
  date: string;
  timeHm: string | null;
} {
  return {
    date: formatPurchaseLedgerDate(iso),
    timeHm: isPurchaseLedgerTimePlaceholderLocal(iso)
      ? null
      : formatPurchaseLedgerTimeHm(iso),
  };
}

/** 매입·매출 내역 표: 월·일만(연도 생략) + 시:분, 한국일 기준. */
export function dailyLedgerDateCellParts(iso: string): {
  date: string;
  timeHm: string | null;
} {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return { date: "—", timeHm: null };
  }
  const ymd = seoulYmdFromIso(iso);
  const [, m, day] = ymd.split("-");
  const date = m && day ? `${Number(m)}월 ${Number(day)}일` : "—";
  return {
    date,
    timeHm: isPurchaseLedgerTimePlaceholderLocal(iso)
      ? null
      : formatPurchaseLedgerTimeHm(iso),
  };
}

/** 매출내역 날짜 셀 — YY.MM.DD + 시:분 */
export function salesLedgerDateCellParts(iso: string): {
  date: string;
  timeHm: string | null;
} {
  return {
    date: formatSalesLedgerDate(iso),
    timeHm: isPurchaseLedgerTimePlaceholderLocal(iso)
      ? null
      : formatPurchaseLedgerTimeHm(iso),
  };
}

/** 월매입·월매출 장부 날짜 칸: 월·일만 (연도·시각 없음), 로컬 달력 기준. */
export function formatMonthlyLedgerMoDay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 매입내역 등: 로컬 기준 시:분 (24시간, 두 자리). */
export function formatPurchaseLedgerTimeHm(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 엑셀 가져오기·월장부 엑셀 복원 등 날짜만 넣을 때 흔한 로컬 시각(0시 또는 12시 정각).
 * 이때는 장부에서 시:분을 표시하지 않는다.
 */
export function isPurchaseLedgerTimePlaceholderLocal(iso: string): boolean {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return true;
  if (d.getMilliseconds() !== 0) return false;
  if (d.getMinutes() !== 0 || d.getSeconds() !== 0) return false;
  const h = d.getHours();
  return h === 0 || h === 12;
}

/** Ledger 표시: 월·일 + 시:분 (연도 없음, 24시간). */
export function formatLedgerDate(iso: string) {
  const d = new Date(iso);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours();
  const min = d.getMinutes();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${m}.${day}\n${pad2(h)}:${pad2(min)}`;
}

/** 같은 날짜인지 비교용 (월별 장부에서 날짜 셀 병합). */
export function formatLedgerDayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 로컬 달력 기준 YYYY-MM-DD (일별 처리시세 키 등). */
export function localYmdFromIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 매장 시재·일일마감 등은 기기 로컬이 아니라 한국 날짜로 통일 (PC/모바일·해외 시차 대비).
 */
export function todayYmdSeoul(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

/** `purchased_at` 등 ISO 시각을 한국(KST) 달력 날짜 `YYYY-MM-DD`로 (장부 일자 기준 통일). */
export function seoulYmdFromIso(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

export function seoulYmdToUtcRangeIso(ymd: string): { from: string; to: string } {
  const from = new Date(`${ymd}T00:00:00+09:00`);
  const to = new Date(`${ymd}T23:59:59.999+09:00`);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** 장부 년도 pill·섹션 — 2025 → 「25년」(20 접두 생략) */
export function formatLedgerYearLabel(year: number): string {
  const y = Math.trunc(Number(year));
  if (!Number.isFinite(y)) return "—";
  const s = String(y);
  const short = s.length >= 4 ? s.slice(-2) : s;
  return `${short}년`;
}

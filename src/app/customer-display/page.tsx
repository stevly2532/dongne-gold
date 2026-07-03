"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatKRW } from "@/lib/format";
import {
  CUSTOMER_DISPLAY_COMPLETE_MS,
  CUSTOMER_DISPLAY_HEARTBEAT_STALE_MS,
  type CustomerDisplayLine,
  type CustomerDisplayPayload,
  isCustomerDisplayPayloadEmpty,
  subscribeCustomerDisplay,
} from "@/lib/customerDisplayBus";
import type {
  KoreanGoldQuoteResponse,
  KoreanGoldQuoteRow,
} from "@/app/api/korean-gold-prices/route";
import {
  fetchGoldgoldQuotesInBrowser,
  relayGoldgoldQuoteToServer,
} from "@/lib/goldgoldClientQuotes";

/**
 * 동네금빵 로고 배경색(베이지). 로고 PNG와 동일한 톤이라 화면이 로고를 자연스럽게 감싸는 인상을 준다.
 */
const BRAND_BEIGE_BG = "#efeae0";

type ScreenMode = "idle" | "active" | "complete";

/**
 * 매입 중 중량·금액을 띄우는 오버레이 사용 여부.
 * false면 대기화면(시세 라인업)만 계속 띄운다. (사용자 요청으로 잠시 비활성화)
 */
const PURCHASE_OVERLAY_ENABLED = false;

/** 고객화면 30초 폴링 (한국표준금거래소 갱신 시 자동 반영) */
const KOREAN_GOLD_POLL_INTERVAL_MS = 30_000;
const KOREAN_GOLD_RETRY_INTERVAL_MS = 10_000;

const DASH = "\u2014";
const LABEL_PURITY = "함량";
const LABEL_WEIGHT = "중량";
const LABEL_AMOUNT = "매입액";
const LABEL_TOTAL = "총 매입금액";
const HEADLINE_ACTIVE = "매입 안내";
const HEADLINE_COMPLETE = "매입이 완료되었습니다";
const SUBLINE_COMPLETE = "감사합니다";
const STATUS_CONNECTED = "연결됨";
const STATUS_WAITING = "대기";
const STATUS_CONNECTED_TITLE = "매입등록 연결됨";
const STATUS_WAITING_TITLE = "매입등록 대기";

function formatWeightG(raw: string | null): string {
  if (raw == null || raw.trim() === "") return DASH;
  const n = parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return DASH;
  return `${n} g`;
}

function formatLineAmount(amt: number | null | undefined): string {
  if (amt == null || !Number.isFinite(amt) || amt <= 0) return DASH;
  return formatKRW(Math.round(amt));
}

/** 라인 행이 의미 있는 값이 하나라도 있는지 */
function lineHasContent(l: CustomerDisplayLine): boolean {
  const hasW =
    l.weightG != null && l.weightG.trim() !== "" && l.weightG !== "—";
  const hasA =
    l.amountWon != null && Number.isFinite(l.amountWon) && l.amountWon > 0;
  const hasP =
    l.purityLabel != null &&
    l.purityLabel.trim() !== "" &&
    l.purityLabel !== "—";
  return hasW || hasA || hasP;
}

function AmountDisplay({ text }: { text: string }) {
  // Tone down commas and currency symbol so they don't look heavy at huge sizes.
  return (
    <>
      {Array.from(text).map((ch, i) => {
        if (ch === ",") {
          return (
            <span
              key={i}
              className="mx-[-0.05em] align-baseline font-medium text-amber-900/40"
            >
              {ch}
            </span>
          );
        }
        if (ch === "\u20A9") {
          return (
            <span
              key={i}
              className="mr-[0.08em] align-baseline text-[0.7em] font-semibold text-amber-900/70"
            >
              {ch}
            </span>
          );
        }
        return <span key={i}>{ch}</span>;
      })}
    </>
  );
}

type LineupRowKey = "pure" | "k18" | "k14" | "white" | "silver";

const LINEUP_ROW_DEFS: ReadonlyArray<{
  key: LineupRowKey;
  label: string;
  sub: string;
  /** "내가 살 때" 셀이 가격 대신 "제품시세적용"으로 고정 표시되는 행. */
  buyAsProductRate?: boolean;
  /** "내가 팔 때" 셀 아래 표기되는 자사 기준 표기. */
  sellFootnote?: string;
}> = [
  { key: "pure", label: "순금시세", sub: "Gold24k-3.75g" },
  {
    key: "k18",
    label: "18K 금시세",
    sub: "Gold18k-3.75g",
    buyAsProductRate: true,
  },
  {
    key: "k14",
    label: "14K 금시세",
    sub: "Gold14k-3.75g",
    buyAsProductRate: true,
  },
  {
    key: "white",
    label: "백금시세",
    sub: "Platinum-3.75g",
    sellFootnote: "(자사백금바기준)",
  },
  {
    key: "silver",
    label: "은시세",
    sub: "Silver-3.75g",
    sellFootnote: "(자사실버바기준)",
  },
];

function formatPriceWon(n: number | null): string {
  if (n == null) return DASH;
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function formatDeltaPct(n: number | null): string {
  if (n == null) return "";
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : n > 0 ? "+" : ""}${abs.toFixed(2)}%`;
}

function formatDeltaAmt(n: number | null): string {
  if (n == null) return "";
  const abs = Math.abs(Math.round(n));
  return abs.toLocaleString("ko-KR");
}

function formatQuoteDate(raw: string | null): string {
  if (!raw) return "";
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}.${m[2]}.${m[3]}`;
}

function PriceCell({
  price,
  deltaPct,
  deltaAmt,
  asProductRate,
  footnote,
}: {
  price: number | null;
  deltaPct: number | null;
  deltaAmt: number | null;
  asProductRate?: boolean;
  footnote?: string;
}) {
  if (asProductRate) {
    return (
      <div className="text-left">
        <div className="text-[clamp(1.25rem,2.4vw,2.25rem)] font-bold text-[var(--foreground)]">
          제품시세적용
        </div>
      </div>
    );
  }
  const direction = deltaPct == null ? 0 : deltaPct < 0 ? -1 : deltaPct > 0 ? 1 : 0;
  // 한국 시세판 관례: 하락=파랑, 상승=빨강. 베이지 라이트 배경에 맞춰 가독성 높은 진한 톤.
  const deltaTone =
    direction < 0
      ? "text-sky-700"
      : direction > 0
        ? "text-rose-700"
        : "text-[var(--muted)]";
  const arrow = direction < 0 ? "▼" : direction > 0 ? "▲" : "";
  return (
    <div className="text-left">
      <div className="text-[clamp(1.5rem,2.8vw,2.75rem)] font-bold tabular-nums text-[var(--foreground)]">
        {formatPriceWon(price)}
      </div>
      {deltaPct != null || deltaAmt != null ? (
        <div
          className={`mt-1 flex items-center gap-1.5 text-[clamp(0.85rem,1.35vw,1.25rem)] font-medium tabular-nums ${deltaTone}`}
        >
          <span>{formatDeltaPct(deltaPct)}</span>
          {arrow ? <span aria-hidden>{arrow}</span> : null}
          <span>{formatDeltaAmt(deltaAmt)}</span>
        </div>
      ) : null}
      {footnote ? (
        <div className="mt-1 text-[clamp(0.7rem,1.1vw,1rem)] text-[var(--muted)]">
          {footnote}
        </div>
      ) : null}
    </div>
  );
}

/** 고객화면 30초 폴링 — 브라우저가 goldgold 직접 fetch (클라우드 IP 403 우회) */
function IdleQuoteCard() {
  const [data, setData] = useState<KoreanGoldQuoteResponse | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = setTimeout(load, delayMs);
    };

    const load = async () => {
      let success = false;
      try {
        const direct = await fetchGoldgoldQuotesInBrowser();
        if (!cancelled && direct?.ok) {
          setData(direct);
          setErrored(false);
          success = true;
          void relayGoldgoldQuoteToServer(direct);
        } else {
          const res = await fetch("/api/korean-gold-prices", { cache: "no-store" });
          if (!res.ok) throw new Error(`status ${res.status}`);
          const json = (await res.json()) as KoreanGoldQuoteResponse;
          if (!cancelled && json.ok) {
            setData(json);
            setErrored(false);
            success = true;
          } else if (!cancelled) {
            setErrored(true);
          }
        }
      } catch {
        if (!cancelled) setErrored(true);
      } finally {
        schedule(
          success
            ? KOREAN_GOLD_POLL_INTERVAL_MS
            : KOREAN_GOLD_RETRY_INTERVAL_MS,
        );
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const dateLabel = formatQuoteDate(data?.quoteAt ?? null);

  return (
    <div
      className="absolute inset-0 flex h-full w-full items-center justify-center overflow-hidden px-[clamp(1rem,4vw,4rem)] py-[clamp(1rem,4vh,4rem)]"
      style={{ backgroundColor: BRAND_BEIGE_BG }}
    >
      <div className="flex h-full w-full max-w-[1400px] flex-col">
        {/* 헤더 — 좌측 제목, 우측 갱신 일자 */}
        <div className="flex items-end justify-between gap-4 border-b border-[var(--border)] pb-[clamp(0.5rem,1.5vh,1.25rem)]">
          <h1 className="text-[clamp(1.5rem,3.5vw,3rem)] font-bold leading-tight text-[var(--foreground)]">
            동네금빵 시세 라인업
          </h1>
          <span className="text-[clamp(0.85rem,1.4vw,1.25rem)] tabular-nums text-[var(--muted)]">
            {dateLabel}
          </span>
        </div>

        {/* 컬럼 헤더 */}
        <div className="grid grid-cols-[1.1fr_1fr_1fr] items-end gap-4 px-1 pt-[clamp(0.75rem,2vh,1.5rem)] pb-[clamp(0.5rem,1.2vh,1rem)]">
          <div />
          <div className="text-[clamp(0.95rem,1.5vw,1.4rem)] font-semibold text-[var(--foreground)]">
            내가 살 때 <span className="text-[var(--muted)]">(VAT포함)</span>
          </div>
          <div className="text-[clamp(0.95rem,1.5vw,1.4rem)] font-semibold text-[var(--foreground)]">
            내가 팔 때{" "}
            <span className="text-[var(--muted)]">(금방금방 앱 기준)</span>
          </div>
        </div>

        {/* 시세 행 */}
        <div className="flex flex-1 flex-col divide-y divide-stone-300/80">
          {LINEUP_ROW_DEFS.map((def) => {
            const row: KoreanGoldQuoteRow | undefined = data?.rows[def.key];
            return (
              <div
                key={def.key}
                className="grid flex-1 grid-cols-[1.1fr_1fr_1fr] items-center gap-4 px-1 py-[clamp(0.5rem,1.5vh,1.25rem)]"
              >
                <div>
                  <div className="text-[clamp(1.5rem,2.8vw,2.75rem)] font-bold leading-tight text-[var(--foreground)]">
                    {def.label}
                  </div>
                  <div className="mt-0.5 text-[clamp(0.85rem,1.3vw,1.2rem)] text-[var(--muted)]">
                    {def.sub}
                  </div>
                </div>
                <PriceCell
                  price={row?.buy ?? null}
                  deltaPct={row?.buyDeltaPct ?? null}
                  deltaAmt={row?.buyDeltaAmt ?? null}
                  asProductRate={def.buyAsProductRate}
                />
                <PriceCell
                  price={row?.sell ?? null}
                  deltaPct={row?.sellDeltaPct ?? null}
                  deltaAmt={row?.sellDeltaAmt ?? null}
                  footnote={def.sellFootnote}
                />
              </div>
            );
          })}
        </div>

        {/* 푸터 — 브랜드 워드마크 */}
        <div className="flex items-center gap-3 pt-[clamp(0.5rem,1vh,0.75rem)] text-[clamp(0.7rem,1vw,0.95rem)] text-[var(--muted)]">
          <span className="font-semibold tracking-wide text-[var(--foreground)]">
            동네금빵 <span className="text-[var(--muted)]">GOLD EXCHANGE &amp; JEWELRY</span>
          </span>
          {data?.stale ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
              캐시 시세 · 잠시 후 자동 갱신
            </span>
          ) : null}
          {errored && !data ? (
            <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-800">
              시세 불러오기 실패 · 재시도 중
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PurchaseOverlay({
  payload,
  headline,
  subline,
}: {
  payload: CustomerDisplayPayload;
  headline: string;
  subline?: string;
}) {
  /**
   * 다중 명세(여러 함량 한 사람에게 매입) 표시.
   * lines가 비어있거나 한 줄이어도 동일한 표 + 총액 카드 형식을 쓴다.
   */
  const rawLines: CustomerDisplayLine[] =
    payload.lines && payload.lines.length > 0
      ? payload.lines
      : [
          {
            purityLabel: payload.purityLabel,
            weightG: payload.weightG,
            weightDon: payload.weightDon,
            amountWon: payload.amountWon,
          },
        ];
  /** 비어있는 라인 제거. 단 모든 라인이 비어있어도 최소 1행은 표시. */
  const filteredLines = rawLines.filter(lineHasContent);
  const lines: CustomerDisplayLine[] =
    filteredLines.length > 0 ? filteredLines : [rawLines[0]];

  const totalWon =
    payload.totalWon != null && Number.isFinite(payload.totalWon)
      ? payload.totalWon
      : lines.reduce(
          (sum, l) =>
            sum + (l.amountWon != null && Number.isFinite(l.amountWon) ? l.amountWon : 0),
          0,
        );
  const totalText = totalWon > 0 ? formatKRW(Math.round(totalWon)) : DASH;
  const multiLine = lines.length > 1;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-amber-50 via-stone-50 to-amber-100/80 px-[clamp(1rem,3vw,3rem)] py-[clamp(1rem,3vh,2.5rem)] text-center">
      {subline ? (
        <p className="mb-2 text-[clamp(1.25rem,2.4vw,2rem)] font-semibold tracking-tight text-amber-900">
          {subline}
        </p>
      ) : null}
      <p className="mb-[clamp(1rem,3vh,2.25rem)] text-[clamp(1.75rem,3.2vw,2.75rem)] font-bold text-[var(--foreground)]">
        {headline}
      </p>

      <div className="flex w-full max-w-[1100px] flex-1 flex-col">
        {/* 표 헤더 */}
        <div className="grid grid-cols-[1.1fr_1fr_1.4fr] items-end gap-4 border-b border-[var(--border)] px-2 pb-[clamp(0.5rem,1vh,0.75rem)]">
          <div className="text-left text-[clamp(1rem,1.6vw,1.5rem)] font-semibold uppercase tracking-widest text-[var(--muted)]">
            {LABEL_PURITY}
          </div>
          <div className="text-center text-[clamp(1rem,1.6vw,1.5rem)] font-semibold uppercase tracking-widest text-[var(--muted)]">
            {LABEL_WEIGHT}
          </div>
          <div className="text-right text-[clamp(1rem,1.6vw,1.5rem)] font-semibold uppercase tracking-widest text-[var(--muted)]">
            {LABEL_AMOUNT}
          </div>
        </div>

        {/* 표 데이터 */}
        <div className="flex flex-1 flex-col divide-y divide-stone-300/70 overflow-hidden">
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid flex-1 grid-cols-[1.1fr_1fr_1.4fr] items-center gap-4 px-2 py-[clamp(0.5rem,1.4vh,1.25rem)]"
            >
              <div className="text-left">
                <span className="text-[clamp(2rem,4.5vw,4.5rem)] font-bold leading-tight text-[var(--foreground)]">
                  {l.purityLabel || DASH}
                </span>
              </div>
              <div className="text-center">
                <span className="text-[clamp(1.75rem,3.8vw,3.75rem)] font-bold tabular-nums leading-tight text-[var(--foreground)]">
                  {formatWeightG(l.weightG)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[clamp(1.75rem,4vw,4rem)] font-bold tabular-nums leading-tight text-amber-950">
                  <AmountDisplay text={formatLineAmount(l.amountWon)} />
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 총 매입금액 카드 */}
        <div
          className="mt-[clamp(0.5rem,1.5vh,1.25rem)] flex items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-white/95 px-[clamp(1rem,2.5vw,2.5rem)] py-[clamp(0.75rem,2vh,1.5rem)] shadow-lg"
        >
          <span className="text-[clamp(1.1rem,2vw,1.85rem)] font-semibold uppercase tracking-widest text-[var(--muted)]">
            {LABEL_TOTAL}
          </span>
          <span className="text-[clamp(2.5rem,5.5vw,5.5rem)] font-bold tabular-nums leading-none text-[var(--foreground)]">
            <AmountDisplay text={totalText} />
          </span>
        </div>
      </div>
    </div>
  );
}

export default function CustomerDisplayPage() {
  const [mode, setMode] = useState<ScreenMode>("idle");
  const [payload, setPayload] = useState<CustomerDisplayPayload | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [mainConnected, setMainConnected] = useState(false);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHeartbeatRef = useRef(0);

  const clearCompleteTimer = useCallback(() => {
    if (completeTimerRef.current != null) {
      clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
  }, []);

  const goIdle = useCallback(() => {
    clearCompleteTimer();
    setMode("idle");
    setPayload(null);
  }, [clearCompleteTimer]);

  const startCompleteTimer = useCallback(() => {
    clearCompleteTimer();
    completeTimerRef.current = setTimeout(() => {
      completeTimerRef.current = null;
      goIdle();
    }, CUSTOMER_DISPLAY_COMPLETE_MS);
  }, [clearCompleteTimer, goIdle]);

  useEffect(() => {
    return subscribeCustomerDisplay((msg) => {
      if (msg.type === "heartbeat") {
        lastHeartbeatRef.current = msg.at;
        setMainConnected(true);
        if (msg.branchName) setBranchName(msg.branchName);
        return;
      }

      if (msg.type === "saved") {
        setPayload(msg.payload);
        setMode("complete");
        startCompleteTimer();
        return;
      }

      if (completeTimerRef.current != null) return;

      if (msg.type === "idle") {
        goIdle();
        return;
      }

      if (msg.type === "draft") {
        if (isCustomerDisplayPayloadEmpty(msg.payload)) {
          goIdle();
          return;
        }
        setPayload(msg.payload);
        setMode("active");
      }
    });
  }, [goIdle, startCompleteTimer]);

  useEffect(() => {
    const tick = () => {
      const last = lastHeartbeatRef.current;
      if (last === 0) {
        setMainConnected(false);
        return;
      }
      setMainConnected(Date.now() - last < CUSTOMER_DISPLAY_HEARTBEAT_STALE_MS);
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => clearCompleteTimer(), [clearCompleteTimer]);

  const showOverlay =
    PURCHASE_OVERLAY_ENABLED && (mode === "active" || mode === "complete");
  const overlayPayload = payload;

  return (
    <>
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          showOverlay ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <IdleQuoteCard />
      </div>

      {showOverlay && overlayPayload ? (
        <div className="absolute inset-0 z-10">
          <PurchaseOverlay
            payload={overlayPayload}
            headline={
              mode === "complete" ? HEADLINE_COMPLETE : HEADLINE_ACTIVE
            }
            subline={
              mode === "complete"
                ? SUBLINE_COMPLETE
                : branchName
                  ? branchName
                  : undefined
            }
          />
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute bottom-3 right-3 z-20 flex items-center gap-2 rounded-full bg-stone-900/50 px-2.5 py-1 text-[10px] text-white/80 backdrop-blur-sm"
        aria-live="polite"
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            mainConnected ? "bg-emerald-400" : "bg-stone-500"
          }`}
          title={mainConnected ? STATUS_CONNECTED_TITLE : STATUS_WAITING_TITLE}
        />
        <span>{mainConnected ? STATUS_CONNECTED : STATUS_WAITING}</span>
      </div>
    </>
  );
}

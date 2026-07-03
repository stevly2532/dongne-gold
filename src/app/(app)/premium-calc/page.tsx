"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatWonInputDisplay,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
} from "@/lib/format";
import type { PremiumMarketQuotesResponse } from "@/lib/premiumMarketQuotes";
import { HelpTooltip } from "@/components/HelpTooltip";

const GRAMS_PER_TROY_OZ = 31.1034768;
const GRAMS_PER_DON = 3.75;
const DON_PER_TROY_OZ = GRAMS_PER_TROY_OZ / GRAMS_PER_DON;
const GRAMS_PER_KG = 1000;
const OZ_PER_KG = GRAMS_PER_KG / GRAMS_PER_TROY_OZ;
const DON_PER_KG = GRAMS_PER_KG / GRAMS_PER_DON;

type Metal = "gold" | "silver";

const LS_KEY_METAL = "goldLedger_premiumCalc_metal";
/** 금 모드: 국내 시세는 원/돈 */
const LS_KEY_GOLD_DOMESTIC = "goldLedger_premiumCalc_domesticWonPerDon";
const LS_KEY_GOLD_FUTURES = "goldLedger_premiumCalc_futuresUsdPerOz";
/** 은 모드: 국내 시세는 원/kg (실버바 1kg 기준) */
const LS_KEY_SILVER_DOMESTIC =
  "goldLedger_premiumCalc_silver_domesticWonPerKg";
const LS_KEY_SILVER_FUTURES =
  "goldLedger_premiumCalc_silver_futuresUsdPerOz";
/** 환율은 금/은 공통으로 사용 */
const LS_KEY_FX = "goldLedger_premiumCalc_fxKrwPerUsd";

/** "1,234.56" 같은 입력을 숫자로. 빈 값이거나 실패하면 null */
function parseDecimalInput(raw: string): number | null {
  const cleaned = raw.replace(/[, _]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 입력 도중의 점/숫자를 보존하면서 정리 */
function sanitizeDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const nodash = cleaned.replace(/,/g, "");
  const firstDot = nodash.indexOf(".");
  if (firstDot === -1) return nodash.slice(0, 12);
  const head = nodash.slice(0, firstDot);
  const tail = nodash.slice(firstDot + 1).replace(/\./g, "");
  return `${head}.${tail}`.slice(0, 14);
}

function formatDecimalDisplay(s: string): string {
  if (!s) return "";
  const hasDot = s.includes(".");
  const [intPart, decPart = ""] = s.split(".");
  const intNum = intPart === "" ? "" : Number(intPart);
  const intDisp =
    intPart === ""
      ? ""
      : Number.isFinite(intNum)
        ? intNum.toLocaleString("en-US")
        : intPart;
  if (!hasDot) return intDisp;
  return `${intDisp}.${decPart}`;
}

function fmtKRW(n: number, digits = 0) {
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

function fmtPct(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function formatDecimalInputFromNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const s = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/\.?0+$/, "");
  return sanitizeDecimalInput(s);
}

function fmtFetchedAt(iso: string) {
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Seoul",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type MetalConfig = {
  /** 단위 라벨에 들어가는 한국어 (예: "금", "은") */
  label: string;
  /** 국내 시세 입력 라벨 */
  domesticLabel: string;
  /** 국내 시세 입력 단위 (표시용) */
  domesticUnit: string;
  /** 국내 시세 placeholder */
  domesticPlaceholder: string;
  /** 국내 시세 보조 설명 */
  domesticHint: string;
  /** 선물시세 라벨 */
  futuresLabel: string;
  futuresPlaceholder: string;
  futuresHint: string;
  /** 결과 카드에서 강조 단위 라벨 (예: "원/돈" 또는 "원/kg") */
  diffUnitLabel: string;
};

const GOLD_CONFIG: MetalConfig = {
  label: "금",
  domesticLabel: "국내 시세 (원/돈, 24K)",
  domesticUnit: "원/돈",
  domesticPlaceholder: "예: 750,000",
  domesticHint: "소매 기준 한국 금 시세 (원/돈)",
  futuresLabel: "국제 금 시세 (USD/oz)",
  futuresPlaceholder: "예: 4,065",
  futuresHint: "금 현물 1온스당 달러 (트레이딩뷰 TVC:GOLD에 가까움)",
  diffUnitLabel: "원/돈",
};

const SILVER_CONFIG: MetalConfig = {
  label: "은",
  domesticLabel: "국내 시세 (원/kg, 실버바)",
  domesticUnit: "원/kg",
  domesticPlaceholder: "예: 1,500,000",
  domesticHint: "실버바 1kg 기준 한국 은 시세 (원/kg)",
  futuresLabel: "국제 은 시세 (USD/oz)",
  futuresPlaceholder: "예: 58.60",
  futuresHint: "은 현물 1온스당 달러",
  diffUnitLabel: "원/kg",
};

export default function PremiumCalcPage() {
  const [metal, setMetal] = useState<Metal>("gold");

  /** 금: 원/돈 (정수) */
  const [goldDomestic, setGoldDomestic] = useState("");
  const [goldFutures, setGoldFutures] = useState("");
  /** 은: 원/kg (정수) */
  const [silverDomestic, setSilverDomestic] = useState("");
  const [silverFutures, setSilverFutures] = useState("");
  /** 공용 환율 (소수) */
  const [fxKrwPerUsd, setFxKrwPerUsd] = useState("");
  const [quoteFetchLoading, setQuoteFetchLoading] = useState(false);
  const [quoteFetchError, setQuoteFetchError] = useState<string | null>(null);
  const [quoteMeta, setQuoteMeta] = useState<{
    fetchedAt: string;
    sources: PremiumMarketQuotesResponse["sources"];
  } | null>(null);

  const applyMarketQuotes = useCallback((data: PremiumMarketQuotesResponse) => {
    if (data.goldFuturesUsdPerOz != null) {
      setGoldFutures(formatDecimalInputFromNumber(data.goldFuturesUsdPerOz));
    }
    if (data.silverFuturesUsdPerOz != null) {
      setSilverFutures(formatDecimalInputFromNumber(data.silverFuturesUsdPerOz));
    }
    if (data.fxKrwPerUsd != null) {
      setFxKrwPerUsd(formatDecimalInputFromNumber(data.fxKrwPerUsd));
    }
    if (data.domesticGoldWonPerDon != null) {
      setGoldDomestic(
        sanitizeWonInputDigits(String(Math.round(data.domesticGoldWonPerDon))),
      );
    }
    if (data.domesticSilverWonPerKg != null) {
      setSilverDomestic(
        sanitizeWonInputDigits(String(Math.round(data.domesticSilverWonPerKg))),
      );
    }
    setQuoteMeta({ fetchedAt: data.fetchedAt, sources: data.sources });
  }, []);

  const loadMarketQuotes = useCallback(async () => {
    setQuoteFetchLoading(true);
    setQuoteFetchError(null);
    try {
      const res = await fetch("/api/premium-market-quotes", { cache: "no-store" });
      const data = (await res.json()) as PremiumMarketQuotesResponse & {
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setQuoteFetchError(data.error ?? "시세를 불러오지 못했습니다.");
        return;
      }
      applyMarketQuotes(data);
    } catch {
      setQuoteFetchError("시세를 불러오지 못했습니다.");
    } finally {
      setQuoteFetchLoading(false);
    }
  }, [applyMarketQuotes]);

  useEffect(() => {
    void loadMarketQuotes();
  }, [loadMarketQuotes]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = localStorage.getItem(LS_KEY_METAL);
    if (m === "silver" || m === "gold") setMetal(m);
    const gd = localStorage.getItem(LS_KEY_GOLD_DOMESTIC);
    if (gd) setGoldDomestic(sanitizeWonInputDigits(gd));
    const gf = localStorage.getItem(LS_KEY_GOLD_FUTURES);
    if (gf) setGoldFutures(sanitizeDecimalInput(gf));
    const sd = localStorage.getItem(LS_KEY_SILVER_DOMESTIC);
    if (sd) setSilverDomestic(sanitizeWonInputDigits(sd));
    const sf = localStorage.getItem(LS_KEY_SILVER_FUTURES);
    if (sf) setSilverFutures(sanitizeDecimalInput(sf));
    const x = localStorage.getItem(LS_KEY_FX);
    if (x) setFxKrwPerUsd(sanitizeDecimalInput(x));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LS_KEY_METAL, metal);
  }, [metal]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (goldDomestic.trim())
      localStorage.setItem(LS_KEY_GOLD_DOMESTIC, goldDomestic.trim());
  }, [goldDomestic]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (goldFutures.trim())
      localStorage.setItem(LS_KEY_GOLD_FUTURES, goldFutures.trim());
  }, [goldFutures]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (silverDomestic.trim())
      localStorage.setItem(LS_KEY_SILVER_DOMESTIC, silverDomestic.trim());
  }, [silverDomestic]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (silverFutures.trim())
      localStorage.setItem(LS_KEY_SILVER_FUTURES, silverFutures.trim());
  }, [silverFutures]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (fxKrwPerUsd.trim())
      localStorage.setItem(LS_KEY_FX, fxKrwPerUsd.trim());
  }, [fxKrwPerUsd]);

  const cfg = metal === "gold" ? GOLD_CONFIG : SILVER_CONFIG;
  const domestic = metal === "gold" ? goldDomestic : silverDomestic;
  const setDomestic = metal === "gold" ? setGoldDomestic : setSilverDomestic;
  const futures = metal === "gold" ? goldFutures : silverFutures;
  const setFutures = metal === "gold" ? setGoldFutures : setSilverFutures;

  const result = useMemo(() => {
    const dom = parseWonDigitsToNumber(domestic);
    const fut = parseDecimalInput(futures);
    const fx = parseDecimalInput(fxKrwPerUsd);
    if (
      dom == null ||
      !Number.isFinite(dom) ||
      dom <= 0 ||
      fut == null ||
      !Number.isFinite(fut) ||
      fut <= 0 ||
      fx == null ||
      !Number.isFinite(fx) ||
      fx <= 0
    ) {
      return null;
    }
    /** 국제 시세를 원화로 변환 (단위별) */
    const intlKrwPerOz = fut * fx;
    const intlKrwPerG = intlKrwPerOz / GRAMS_PER_TROY_OZ;
    const intlKrwPerDon = intlKrwPerOz / DON_PER_TROY_OZ;
    const intlKrwPerKg = intlKrwPerOz * OZ_PER_KG;

    /** 국내 시세를 단위별로 환산 */
    let domKrwPerG: number;
    let domKrwPerOz: number;
    let domKrwPerDon: number;
    let domKrwPerKg: number;
    if (metal === "gold") {
      // 입력은 원/돈
      domKrwPerDon = dom;
      domKrwPerG = dom / GRAMS_PER_DON;
      domKrwPerOz = dom * DON_PER_TROY_OZ;
      domKrwPerKg = dom * DON_PER_KG;
    } else {
      // 입력은 원/kg
      domKrwPerKg = dom;
      domKrwPerG = dom / GRAMS_PER_KG;
      domKrwPerOz = dom / OZ_PER_KG;
      domKrwPerDon = dom / DON_PER_KG;
    }

    /** 프리미엄 기준 단위: 금은 원/돈, 은은 원/kg */
    const domBase = metal === "gold" ? domKrwPerDon : domKrwPerKg;
    const intlBase = metal === "gold" ? intlKrwPerDon : intlKrwPerKg;
    const diffBase = domBase - intlBase;
    const premiumPct = (diffBase / intlBase) * 100;

    return {
      intlKrwPerOz,
      intlKrwPerG,
      intlKrwPerDon,
      intlKrwPerKg,
      domKrwPerOz,
      domKrwPerG,
      domKrwPerDon,
      domKrwPerKg,
      domBase,
      intlBase,
      diffBase,
      premiumPct,
    };
  }, [domestic, futures, fxKrwPerUsd, metal]);

  const allFilled = domestic.trim() && futures.trim() && fxKrwPerUsd.trim();

  /** 결과 카드용 기준 단위 텍스트 */
  const baseUnit = cfg.diffUnitLabel;

  const fieldLabel = "toss-form-label mb-1 block";
  const fieldInput =
    "toss-input mt-1.5 h-9 w-full px-2 text-sm tabular-nums text-[var(--foreground)]";
  const fieldHint = "mt-1 text-[10px] leading-snug text-[var(--muted)]";

  const premiumHelpTooltip = (
    <div className="space-y-1.5 text-left">
      <p>
        국내 시세와 국제 선물(USD/oz)×환율을 비교해 한국 시장의 프리미엄(%)을
        계산합니다.
      </p>
      <ul className="list-inside list-disc space-y-0.5">
        <li>국제 금·은: 현물 XAU/XAG (트레이딩뷰 TVC:GOLD에 가까움, 실패 시 COMEX)</li>
        <li>환율: Yahoo Finance USD/KRW</li>
        <li>국내 금·은: 한국표준금거래소 시세 자동 불러오기</li>
        <li>
          1 troy oz = {GRAMS_PER_TROY_OZ}g · 1돈 = {GRAMS_PER_DON}g · 1kg =
          1,000g
        </li>
      </ul>
    </div>
  );

  const metalPill = (active: boolean) =>
    active
      ? "tongsang-pill tongsang-pill-active px-3 py-1.5 text-sm"
      : "tongsang-pill tongsang-pill-inactive px-3 py-1.5 text-sm";

  return (
    <div className="mx-auto w-full max-w-[64rem] space-y-5 px-4 sm:px-5 lg:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-xl font-bold tracking-tight text-[var(--foreground)] lg:text-2xl">
              프리미엄 계산기
            </h1>
            <HelpTooltip label="프리미엄 계산기 도움말" trigger="text">
              {premiumHelpTooltip}
            </HelpTooltip>
          </div>
          {quoteMeta ? (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              시세 갱신 {fmtFetchedAt(quoteMeta.fetchedAt)} (서울)
            </p>
          ) : null}
          {quoteFetchError ? (
            <p className="mt-1 text-[11px] text-rose-600">{quoteFetchError}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadMarketQuotes()}
            disabled={quoteFetchLoading}
            className="tongsang-pill tongsang-pill-inactive px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {quoteFetchLoading ? "불러오는 중…" : "시세 새로고침"}
          </button>
          <div className="inline-flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setMetal("gold")}
              className={metalPill(metal === "gold")}
            >
              금
            </button>
            <button
              type="button"
              onClick={() => setMetal("silver")}
              className={metalPill(metal === "silver")}
            >
              은
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="purchase-ledger-work-card p-4">
          <label className={fieldLabel}>{cfg.domesticLabel}</label>
          <input
            value={formatWonInputDisplay(domestic)}
            onChange={(e) => setDomestic(sanitizeWonInputDigits(e.target.value))}
            inputMode="numeric"
            placeholder={cfg.domesticPlaceholder}
            className={fieldInput}
          />
          <p className={fieldHint}>{cfg.domesticHint}</p>
        </div>

        <div className="purchase-ledger-work-card p-4">
          <label className={fieldLabel}>{cfg.futuresLabel}</label>
          <input
            value={formatDecimalDisplay(futures)}
            onChange={(e) => setFutures(sanitizeDecimalInput(e.target.value))}
            inputMode="decimal"
            placeholder={cfg.futuresPlaceholder}
            className={fieldInput}
          />
          <p className={fieldHint}>{cfg.futuresHint}</p>
        </div>

        <div className="purchase-ledger-work-card p-4">
          <label className={fieldLabel}>환율 (원/USD)</label>
          <input
            value={formatDecimalDisplay(fxKrwPerUsd)}
            onChange={(e) => setFxKrwPerUsd(sanitizeDecimalInput(e.target.value))}
            inputMode="decimal"
            placeholder="예: 1,380.50"
            className={fieldInput}
          />
          <p className={fieldHint}>USD 1달러당 원 (금·은 공용)</p>
        </div>
      </section>

      {!allFilled ? (
        <section className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-subtle)] p-6 text-center text-sm text-[var(--muted)]">
          세 가지 값을 모두 입력하면 프리미엄이 자동으로 계산됩니다.
        </section>
      ) : result == null ? (
        <section className="toss-alert-error rounded-xl px-4 py-6 text-center text-sm">
          입력값이 올바르지 않습니다. 0보다 큰 숫자로 입력해 주세요.
        </section>
      ) : (
        <>
          <section
            className={`rounded-xl border p-5 shadow-sm ${
              result.premiumPct >= 0
                ? metal === "gold"
                  ? "border-amber-200 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-950/30"
                  : "border-[var(--border)] bg-[var(--surface-subtle)]"
                : "border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/30"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="toss-form-label uppercase tracking-wide">
                  국내 {cfg.label} 프리미엄
                </p>
                <p
                  className={`mt-1 text-4xl font-bold tabular-nums tracking-tight ${
                    result.premiumPct >= 0
                      ? metal === "gold"
                        ? "text-amber-900 dark:text-amber-100"
                        : "text-[var(--foreground)]"
                      : "text-positive"
                  }`}
                >
                  {fmtPct(result.premiumPct, 2)}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  국내 시세가 국제(선물×환율) 대비{" "}
                  {result.premiumPct >= 0 ? "비싸요" : "싸요"}
                </p>
              </div>
              <div className="text-right text-xs tabular-nums text-[var(--foreground)]">
                <p>
                  국내{" "}
                  <span className="font-medium">
                    {fmtKRW(result.domBase, 0)}
                    {baseUnit}
                  </span>
                </p>
                <p>
                  국제{" "}
                  <span className="font-medium">
                    {fmtKRW(result.intlBase, 0)}
                    {baseUnit}
                  </span>
                </p>
                <p
                  className={`mt-0.5 font-medium ${
                    result.diffBase >= 0
                      ? metal === "gold"
                        ? "text-amber-900 dark:text-amber-100"
                        : "text-[var(--foreground)]"
                      : "text-positive"
                  }`}
                >
                  차이 {result.diffBase >= 0 ? "+" : ""}
                  {fmtKRW(result.diffBase, 0)}
                  {baseUnit}
                </p>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="purchase-ledger-work-card p-4">
              <p className="toss-form-label uppercase tracking-wide">
                국제 시세 (선물×환율)
              </p>
              <table className="mt-2 w-full border-collapse text-sm tabular-nums">
                <tbody className="text-[var(--foreground)]">
                  <tr className="border-b border-[var(--border)]">
                    <td className="py-1.5 text-[var(--muted)]">원/oz</td>
                    <td className="py-1.5 text-right font-medium">
                      {fmtKRW(result.intlKrwPerOz, 0)}
                    </td>
                  </tr>
                  <tr className="border-b border-[var(--border)]">
                    <td className="py-1.5 text-[var(--muted)]">원/g</td>
                    <td className="py-1.5 text-right font-medium">
                      {fmtKRW(result.intlKrwPerG, 0)}
                    </td>
                  </tr>
                  <tr className="border-b border-[var(--border)]">
                    <td className="py-1.5 text-[var(--muted)]">원/돈</td>
                    <td className="py-1.5 text-right font-medium">
                      {fmtKRW(result.intlKrwPerDon, 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-[var(--muted)]">원/kg</td>
                    <td className="py-1.5 text-right font-medium">
                      {fmtKRW(result.intlKrwPerKg, 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="purchase-ledger-work-card p-4">
              <p className="toss-form-label uppercase tracking-wide">
                국내 시세 환산
              </p>
              <table className="mt-2 w-full border-collapse text-sm tabular-nums">
                <tbody className="text-[var(--foreground)]">
                  <tr className="border-b border-[var(--border)]">
                    <td className="py-1.5 text-[var(--muted)]">원/oz</td>
                    <td className="py-1.5 text-right font-medium">
                      {fmtKRW(result.domKrwPerOz, 0)}
                    </td>
                  </tr>
                  <tr className="border-b border-[var(--border)]">
                    <td className="py-1.5 text-[var(--muted)]">원/g</td>
                    <td className="py-1.5 text-right font-medium">
                      {fmtKRW(result.domKrwPerG, 0)}
                    </td>
                  </tr>
                  <tr className="border-b border-[var(--border)]">
                    <td className="py-1.5 text-[var(--muted)]">원/돈</td>
                    <td className="py-1.5 text-right font-medium">
                      {fmtKRW(result.domKrwPerDon, 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-[var(--muted)]">원/kg</td>
                    <td className="py-1.5 text-right font-medium">
                      {fmtKRW(result.domKrwPerKg, 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="purchase-ledger-work-card p-4 text-xs leading-relaxed text-[var(--muted)]">
            <p className="text-sm font-semibold text-[var(--foreground)]">
              계산 방법
            </p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>
                국제 원/oz = 선물(USD/oz) × 환율(원/USD) ={" "}
                <span className="tabular-nums">
                  {parseDecimalInput(futures)?.toLocaleString("en-US")}
                </span>{" "}
                ×{" "}
                <span className="tabular-nums">
                  {parseDecimalInput(fxKrwPerUsd)?.toLocaleString("en-US")}
                </span>{" "}
                ={" "}
                <span className="font-medium tabular-nums text-[var(--foreground)]">
                  {fmtKRW(result.intlKrwPerOz, 0)}원/oz
                </span>
              </li>
              {metal === "gold" ? (
                <li>
                  국제 원/돈 = 국제 원/oz ÷ ({GRAMS_PER_TROY_OZ} / {GRAMS_PER_DON})
                  ={" "}
                  <span className="font-medium tabular-nums text-[var(--foreground)]">
                    {fmtKRW(result.intlKrwPerDon, 0)}원/돈
                  </span>
                </li>
              ) : (
                <li>
                  국제 원/kg = 국제 원/oz × (1,000 / {GRAMS_PER_TROY_OZ}) ={" "}
                  <span className="font-medium tabular-nums text-[var(--foreground)]">
                    {fmtKRW(result.intlKrwPerKg, 0)}원/kg
                  </span>
                </li>
              )}
              <li>
                프리미엄(%) = (국내 − 국제) ÷ 국제 × 100 ={" "}
                <span className="font-medium tabular-nums text-[var(--foreground)]">
                  {fmtPct(result.premiumPct, 2)}
                </span>
              </li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

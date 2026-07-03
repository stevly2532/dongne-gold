import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { KoreanGoldQuoteResponse } from "@/lib/koreanGoldQuotes";

const FALLBACK_FILENAME = "korean-gold-quote-fallback.json";

/** 배포에 포함된 정적 시세 — Vercel 403·DB 캐시 비어 있을 때 최후 폴백 */
export function loadKoreanGoldQuoteFallbackFile(): KoreanGoldQuoteResponse | null {
  try {
    const path = join(process.cwd(), "public", FALLBACK_FILENAME);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as KoreanGoldQuoteResponse;
    if (!parsed?.ok || !parsed.rows) return null;
    return parsed;
  } catch (e) {
    console.error("[korean-gold-quotes] fallback file read failed", e);
    return null;
  }
}

export const KOREAN_GOLD_QUOTE_FALLBACK_PUBLIC_PATH = `/${FALLBACK_FILENAME}`;

/** CDN·브라우저 — 실시간 upstream 성공 응답 (30초 폴링과 맞춤) */
export const KOREAN_GOLD_QUOTE_LIVE_HEADERS = {
  "Cache-Control": "public, s-maxage=25, stale-while-revalidate=60",
} as const;

/** 백업(파일·DB) 시세 — CDN에 오래 묶이지 않게 */
export const KOREAN_GOLD_QUOTE_STALE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
} as const;

/** @deprecated use LIVE or STALE */
export const KOREAN_GOLD_QUOTE_CACHE_HEADERS = KOREAN_GOLD_QUOTE_LIVE_HEADERS;

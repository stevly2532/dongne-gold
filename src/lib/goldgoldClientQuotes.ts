/**
 * 고객화면(브라우저·폰)에서 goldgold API 직접 fetch.
 * goldgold CORS=* 이라 Vercel/GitHub IP 403 우회 — 매장 PC 없이 30초 갱신.
 */

import {
  GOLDGOLD_INDEX_PRICE_API,
  GOLDGOLD_FETCH_TIMEOUT_MS,
} from "@/lib/goldgoldKgsQuotes";
import {
  goldgoldIndexPriceHasQuote,
  parseGoldgoldIndexPriceJson,
  type GoldgoldIndexPriceRaw,
} from "@/lib/goldgoldIndexPriceParse";
import {
  buildKoreanGoldQuoteResponse,
  koreanGoldQuoteSignature,
  type KoreanGoldQuoteResponse,
} from "@/lib/koreanGoldQuotes";

let lastRelayedSignature: string | null = null;

export async function fetchGoldgoldQuotesInBrowser(): Promise<KoreanGoldQuoteResponse | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GOLDGOLD_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(GOLDGOLD_INDEX_PRICE_API, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as GoldgoldIndexPriceRaw;
    if (!json || typeof json !== "object" || !goldgoldIndexPriceHasQuote(json)) {
      return null;
    }
    const official = parseGoldgoldIndexPriceJson(json);
    return buildKoreanGoldQuoteResponse(official, new Date().toISOString());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 브라우저에서 받은 시세를 서버 캐시(Supabase)에 반영 — 매입시세 연동용 */
export async function relayGoldgoldQuoteToServer(
  body: KoreanGoldQuoteResponse,
): Promise<void> {
  const signature = koreanGoldQuoteSignature(body);
  if (signature === lastRelayedSignature) return;
  lastRelayedSignature = signature;

  try {
    const res = await fetch("/api/korean-gold-prices/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    if (!res.ok) {
      lastRelayedSignature = null;
    }
  } catch {
    lastRelayedSignature = null;
  }
}

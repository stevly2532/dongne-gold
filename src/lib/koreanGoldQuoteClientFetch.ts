import type { KoreanGoldQuoteResponse } from "@/lib/koreanGoldQuotes";
import { KOREAN_GOLD_QUOTE_LOCAL_PROXY_URL } from "@/lib/koreanGoldQuotePublicSources";

/** 매장 PC 로컬 프록시 (127.0.0.1) — 한국금거래소 실시간, 30초 폴링 */
export async function fetchKoreanGoldQuoteFromLocalProxy(): Promise<KoreanGoldQuoteResponse | null> {
  try {
    const res = await fetch(`${KOREAN_GOLD_QUOTE_LOCAL_PROXY_URL}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as KoreanGoldQuoteResponse;
    if (!json.ok || !json.rows) return null;
    return json;
  } catch {
    return null;
  }
}

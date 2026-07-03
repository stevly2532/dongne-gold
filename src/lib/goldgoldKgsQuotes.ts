/**
 * 한국표준금거래소(goldgold.co.kr) 시세 API — 서버 fetch.
 * 클라우드(Vercel·GitHub) IP는 403 될 수 있음 → 고객화면은 브라우저 직접 fetch.
 */

import {
  goldgoldIndexPriceHasQuote,
  parseGoldgoldIndexPriceJson,
  type GoldgoldIndexPriceRaw,
} from "@/lib/goldgoldIndexPriceParse";

export const GOLDGOLD_INDEX_PRICE_API =
  "https://irena111.cafe24.com/api/goldgold/mapper.indexPrice.php";
export const GOLDGOLD_FETCH_TIMEOUT_MS = 12_000;

export async function fetchGoldgoldOfficialPrice4(): Promise<
  | { ok: true; officialPrice4: ReturnType<typeof parseGoldgoldIndexPriceJson> }
  | { ok: false; status: number; error: string }
> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GOLDGOLD_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(GOLDGOLD_INDEX_PRICE_API, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; gold-ledger/1.0; +https://YOUR-SITE.vercel.app)",
      },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `goldgold ${res.status}` };
    }
    const json = (await res.json()) as GoldgoldIndexPriceRaw;
    if (!json || typeof json !== "object") {
      return { ok: false, status: 502, error: "goldgold invalid json" };
    }
    if (!goldgoldIndexPriceHasQuote(json)) {
      return { ok: false, status: 502, error: "goldgold missing today gold quote" };
    }
    return { ok: true, officialPrice4: parseGoldgoldIndexPriceJson(json) };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "goldgold fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

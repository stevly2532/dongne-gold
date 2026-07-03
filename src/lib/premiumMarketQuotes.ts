import { loadKoreanGoldQuoteFallbackFile } from "@/lib/koreanGoldQuoteFallbackFile";
import { fetchKoreanGoldQuoteUpstream } from "@/lib/koreanGoldQuoteUpstream";
import {
  buildKoreanGoldQuoteResponse,
  pickNewestKoreanGoldQuote,
  type KoreanGoldQuoteResponse,
} from "@/lib/koreanGoldQuotes";

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const SPOT_METAL_API = "https://api.gold-api.com/price";
const FETCH_TIMEOUT_MS = 12_000;

const YAHOO_SYMBOLS = {
  goldFutures: "GC=F",
  silverFutures: "SI=F",
  usdKrw: "KRW=X",
} as const;

/** 금·은 현물 (XAU/XAG USD/oz) — 트레이딩뷰 TVC:GOLD 등 현물 차트에 가깝다 */
const SPOT_METAL_SYMBOLS = {
  gold: "XAU",
  silver: "XAG",
} as const;

type YahooQuote = {
  price: number | null;
  changePercent: number | null;
};

export type PremiumMarketQuotesResponse = {
  ok: boolean;
  fetchedAt: string;
  goldFuturesUsdPerOz: number | null;
  silverFuturesUsdPerOz: number | null;
  fxKrwPerUsd: number | null;
  /** 한국표준금거래소 순금 매도 시세 (원/돈) */
  domesticGoldWonPerDon: number | null;
  /** 거래소 은 매도 시세 원/g × 1,000 */
  domesticSilverWonPerKg: number | null;
  sources: {
    futures: string;
    fx: string;
    domestic: string;
  };
  error?: string;
};

let premiumMemCache: {
  expiresAt: number;
  body: PremiumMarketQuotesResponse;
} | null = null;
const PREMIUM_CACHE_TTL_MS = 60_000;

async function fetchSpotMetalUsdPerOz(
  symbol: (typeof SPOT_METAL_SYMBOLS)[keyof typeof SPOT_METAL_SYMBOLS],
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SPOT_METAL_API}/${symbol}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; gold-ledger/1.0; premium-market-quotes)",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { price?: unknown };
    const n = typeof json.price === "number" ? json.price : Number(json.price);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooQuote(symbol: string): Promise<YahooQuote> {
  const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; gold-ledger/1.0; premium-market-quotes)",
      },
      cache: "no-store",
    });
    if (!res.ok) return { price: null, changePercent: null };
    const json = (await res.json()) as {
      chart?: { result?: { meta?: Record<string, unknown> }[] };
    };
    const meta = json.chart?.result?.[0]?.meta;
    if (!meta) return { price: null, changePercent: null };

    const priceCandidates = [
      meta.regularMarketPrice,
      meta.previousClose,
      meta.chartPreviousClose,
    ];
    let price: number | null = null;
    for (const c of priceCandidates) {
      const n = typeof c === "number" ? c : Number(c);
      if (Number.isFinite(n) && n > 0) {
        price = n;
        break;
      }
    }

    const directPct = meta.regularMarketChangePercent;
    const pctNum = typeof directPct === "number" ? directPct : Number(directPct);
    let changePercent: number | null = Number.isFinite(pctNum) ? pctNum : null;
    if (changePercent == null && price != null) {
      const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
      if (Number.isFinite(prev) && prev > 0) {
        changePercent = ((price - prev) / prev) * 100;
      }
    }

    return { price, changePercent };
  } catch {
    return { price: null, changePercent: null };
  } finally {
    clearTimeout(timer);
  }
}

/** 프리미엄 계산기 — XAU 현물, 실패 시 COMEX GC=F */
async function resolvePremiumGoldUsdPerOz(): Promise<{
  price: number | null;
  spotUsed: boolean;
  comexQuote: YahooQuote;
}> {
  const [goldSpotUsdPerOz, comexQuote] = await Promise.all([
    fetchSpotMetalUsdPerOz(SPOT_METAL_SYMBOLS.gold),
    fetchYahooQuote(YAHOO_SYMBOLS.goldFutures),
  ]);
  const spotUsed = goldSpotUsdPerOz != null;
  return {
    price: goldSpotUsdPerOz ?? comexQuote.price,
    spotUsed,
    comexQuote,
  };
}

async function loadDomesticKoreanQuotes(): Promise<{
  gold: number | null;
  silver: number | null;
}> {
  const upstream = await fetchKoreanGoldQuoteUpstream();
  let body: KoreanGoldQuoteResponse | null = null;
  if (upstream.ok) {
    body = buildKoreanGoldQuoteResponse(
      upstream.officialPrice4,
      new Date().toISOString(),
    );
  } else {
    body = pickNewestKoreanGoldQuote([loadKoreanGoldQuoteFallbackFile()]);
  }
  if (!body) return { gold: null, silver: null };

  const goldSell = body.rows.pure.sell;
  const silverPerG = body.rows.silver.sell;
  return {
    gold:
      goldSell != null && Number.isFinite(goldSell) && goldSell > 0
        ? Math.round(goldSell)
        : null,
    silver:
      silverPerG != null && Number.isFinite(silverPerG) && silverPerG > 0
        ? Math.round(silverPerG * 1000)
        : null,
  };
}

export async function fetchPremiumMarketQuotes(): Promise<PremiumMarketQuotesResponse> {
  const now = Date.now();
  if (premiumMemCache && premiumMemCache.expiresAt > now) {
    return premiumMemCache.body;
  }

  const fetchedAt = new Date().toISOString();
  const [
    goldResolved,
    silverSpotUsdPerOz,
    silverComexQuote,
    fxQuote,
    domestic,
  ] = await Promise.all([
    resolvePremiumGoldUsdPerOz(),
    fetchSpotMetalUsdPerOz(SPOT_METAL_SYMBOLS.silver),
    fetchYahooQuote(YAHOO_SYMBOLS.silverFutures),
    fetchYahooQuote(YAHOO_SYMBOLS.usdKrw),
    loadDomesticKoreanQuotes(),
  ]);

  const goldFuturesUsdPerOz = goldResolved.price;
  const silverFuturesUsdPerOz =
    silverSpotUsdPerOz ?? silverComexQuote.price;
  const fxKrwPerUsd = fxQuote.price;

  const intlSource =
    goldResolved.spotUsed || silverSpotUsdPerOz != null
      ? "gold-api.com · 금(XAU)·은(XAG) 현물 USD/oz (트레이딩뷰 TVC:GOLD에 가까움)"
      : "Yahoo Finance · COMEX 근월물 GC=F·SI=F (현물 조회 실패 시 대체)";

  const ok = Boolean(
    goldFuturesUsdPerOz ||
      silverFuturesUsdPerOz ||
      fxKrwPerUsd ||
      domestic.gold ||
      domestic.silver,
  );

  const body: PremiumMarketQuotesResponse = {
    ok,
    fetchedAt,
    goldFuturesUsdPerOz,
    silverFuturesUsdPerOz,
    fxKrwPerUsd,
    domesticGoldWonPerDon: domestic.gold,
    domesticSilverWonPerKg: domestic.silver,
    sources: {
      futures: intlSource,
      fx: "Yahoo Finance · USD/KRW",
      domestic: "한국표준금거래소 매도 시세 (금 원/돈 · 은 원/g→원/kg)",
    },
    ...(ok
      ? {}
      : {
          error:
            "시세를 가져오지 못했습니다. 네트워크 확인 후 다시 시도해 주세요.",
        }),
  };

  premiumMemCache = { expiresAt: now + PREMIUM_CACHE_TTL_MS, body };
  return body;
}

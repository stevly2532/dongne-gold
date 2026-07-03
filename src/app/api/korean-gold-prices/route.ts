import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadKoreanGoldQuoteCache,
  saveKoreanGoldQuoteCache,
} from "@/lib/koreanGoldQuoteCache";
import {
  KOREAN_GOLD_QUOTE_LIVE_HEADERS,
  KOREAN_GOLD_QUOTE_STALE_HEADERS,
  loadKoreanGoldQuoteFallbackFile,
} from "@/lib/koreanGoldQuoteFallbackFile";
import { fetchKoreanGoldQuoteUpstream } from "@/lib/koreanGoldQuoteUpstream";
import {
  buildKoreanGoldQuoteResponse,
  isQuoteAtTodaySeoul,
  pickNewestKoreanGoldQuote,
  todayYmdSeoul,
  type KoreanGoldQuoteErrorResponse,
  type KoreanGoldQuoteResponse,
  type KoreanGoldQuoteRow,
} from "@/lib/koreanGoldQuotes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type { KoreanGoldQuoteRow, KoreanGoldQuoteResponse, KoreanGoldQuoteErrorResponse };

/** 고객화면 30초 폴링 (한국표준금거래소 장 중·오전 10시 전후 갱신 반영) */
const MEM_CACHE_TTL_MS = 25_000;

let quoteMemCache: {
  expiresAt: number;
  body: KoreanGoldQuoteResponse;
} | null = null;

async function autoSaveGoldPrice(storePricePerDon: number | null): Promise<void> {
  if (
    storePricePerDon == null ||
    !Number.isFinite(storePricePerDon) ||
    storePricePerDon <= 0
  ) {
    return;
  }
  const admin = createAdminClient();
  if (!admin) return;
  const pricePerDon = Math.round(storePricePerDon);
  const ymd = todayYmdSeoul();
  const { error } = await admin
    .from("daily_purchase_prices")
    .upsert(
      {
        quote_date: ymd,
        quote_scope: "gold",
        price_per_don: pricePerDon,
        updated_at: new Date().toISOString(),
        updated_by: null,
      },
      { onConflict: "quote_date,quote_scope" },
    );
  if (error) {
    console.error("[korean-gold-prices] auto-save daily_purchase_prices failed", error);
  }
}

function jsonLive(body: KoreanGoldQuoteResponse) {
  const payload: KoreanGoldQuoteResponse = {
    ...body,
    fetchedAt: new Date().toISOString(),
    stale: undefined,
  };
  quoteMemCache = {
    expiresAt: Date.now() + MEM_CACHE_TTL_MS,
    body: payload,
  };
  return NextResponse.json(payload, { headers: KOREAN_GOLD_QUOTE_LIVE_HEADERS });
}

function jsonStale(body: KoreanGoldQuoteResponse) {
  return NextResponse.json(
    { ...body, fetchedAt: new Date().toISOString(), stale: true },
    { headers: KOREAN_GOLD_QUOTE_STALE_HEADERS },
  );
}

function respondQuote(body: KoreanGoldQuoteResponse, live: boolean) {
  return live ? jsonLive(body) : jsonStale(body);
}

export async function GET() {
  const now = Date.now();
  if (quoteMemCache && quoteMemCache.expiresAt > now && !quoteMemCache.body.stale) {
    return jsonLive(quoteMemCache.body);
  }

  const admin = createAdminClient();
  const fetchedAt = new Date().toISOString();

  const upstream = await fetchKoreanGoldQuoteUpstream();

  if (upstream.ok) {
    const body = buildKoreanGoldQuoteResponse(upstream.officialPrice4, fetchedAt);
    if (admin) {
      try {
        await saveKoreanGoldQuoteCache(admin, body);
      } catch (e) {
        console.error("[korean-gold-prices] save cache threw", e);
      }
    }
    try {
      await autoSaveGoldPrice(body.rows.pure.sell);
    } catch (e) {
      console.error("[korean-gold-prices] autoSaveGoldPrice threw", e);
    }
    return jsonLive(body);
  }

  console.warn(
    "[korean-gold-prices] upstream failed, using backup",
    upstream.error,
  );

  let cached: KoreanGoldQuoteResponse | null = null;
  if (admin) {
    try {
      cached = await loadKoreanGoldQuoteCache(admin);
    } catch (e) {
      console.error("[korean-gold-prices] load cache threw", e);
    }
  }

  const fallback = loadKoreanGoldQuoteFallbackFile();
  const best = pickNewestKoreanGoldQuote([cached, fallback]);

  if (best) {
    try {
      await autoSaveGoldPrice(best.rows.pure.sell);
    } catch (e) {
      console.error("[korean-gold-prices] autoSaveGoldPrice (backup) threw", e);
    }
    const live = isQuoteAtTodaySeoul(best.quoteAt);
    return respondQuote(best, live);
  }

  const body: KoreanGoldQuoteErrorResponse = {
    ok: false,
    error: upstream.error,
  };
  return NextResponse.json(body, {
    status: 502,
    headers: KOREAN_GOLD_QUOTE_STALE_HEADERS,
  });
}

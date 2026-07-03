import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadKoreanGoldQuoteCache,
  saveKoreanGoldQuoteCache,
} from "@/lib/koreanGoldQuoteCache";
import {
  koreanGoldQuotesEqual,
  todayYmdSeoul,
  type KoreanGoldQuoteResponse,
} from "@/lib/koreanGoldQuotes";

async function autoSaveGoldPriceIfChanged(
  admin: SupabaseClient,
  storePricePerDon: number | null,
  fetchedAt: string,
): Promise<boolean> {
  if (
    storePricePerDon == null ||
    !Number.isFinite(storePricePerDon) ||
    storePricePerDon <= 0
  ) {
    return false;
  }
  const pricePerDon = Math.round(storePricePerDon);
  const ymd = todayYmdSeoul();
  const { data, error: readErr } = await admin
    .from("daily_purchase_prices")
    .select("price_per_don")
    .eq("quote_date", ymd)
    .eq("quote_scope", "gold")
    .maybeSingle();
  if (readErr) {
    console.error("[korean-gold-quotes] read daily_purchase_prices failed", readErr);
  } else if (
    data?.price_per_don != null &&
    Math.round(Number(data.price_per_don)) === pricePerDon
  ) {
    return false;
  }

  const { error } = await admin.from("daily_purchase_prices").upsert(
    {
      quote_date: ymd,
      quote_scope: "gold",
      price_per_don: pricePerDon,
      updated_at: fetchedAt,
      updated_by: null,
    },
    { onConflict: "quote_date,quote_scope" },
  );
  if (error) {
    console.error("[korean-gold-quotes] daily_purchase_prices upsert failed", error);
    return false;
  }
  return true;
}

/** 캐시·매입시세를 시세가 바뀐 경우에만 저장 (egress·쓰기 절감) */
export async function syncKoreanGoldQuoteIfChanged(
  admin: SupabaseClient,
  body: KoreanGoldQuoteResponse,
): Promise<{ cacheSaved: boolean; priceSaved: boolean }> {
  const existing = await loadKoreanGoldQuoteCache(admin);
  const cacheUnchanged = existing != null && koreanGoldQuotesEqual(existing, body);

  let cacheSaved = false;
  if (!cacheUnchanged) {
    await saveKoreanGoldQuoteCache(admin, body);
    cacheSaved = true;
  }

  const priceSaved = await autoSaveGoldPriceIfChanged(
    admin,
    body.rows.pure.sell,
    body.fetchedAt,
  );

  return { cacheSaved, priceSaved };
}

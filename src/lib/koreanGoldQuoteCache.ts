import type { SupabaseClient } from "@supabase/supabase-js";
import type { KoreanGoldQuoteResponse } from "@/lib/koreanGoldQuotes";

export const KOREAN_GOLD_QUOTE_CACHE_ID = "latest";

function parseCachedPayload(payload: unknown): KoreanGoldQuoteResponse | null {
  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    return null;
  }
  const body = payload as KoreanGoldQuoteResponse;
  if (!body.ok || !body.rows) return null;
  return body;
}

export type KoreanGoldQuoteCacheEntry = {
  body: KoreanGoldQuoteResponse;
  /** DB fetched_at (GitHub ingest 시각) */
  syncedAt: string | null;
};

export async function loadKoreanGoldQuoteCache(
  admin: SupabaseClient,
): Promise<KoreanGoldQuoteResponse | null> {
  const entry = await loadKoreanGoldQuoteCacheEntry(admin);
  return entry?.body ?? null;
}

export async function loadKoreanGoldQuoteCacheEntry(
  admin: SupabaseClient,
): Promise<KoreanGoldQuoteCacheEntry | null> {
  const { data, error } = await admin
    .from("korean_gold_quote_cache")
    .select("payload, fetched_at")
    .eq("id", KOREAN_GOLD_QUOTE_CACHE_ID)
    .maybeSingle();
  if (error) {
    console.error("[korean-gold-quotes] load cache failed", error);
    return null;
  }
  const body = parseCachedPayload(data?.payload);
  if (!body) return null;
  const syncedAt =
    typeof data?.fetched_at === "string" ? data.fetched_at : body.fetchedAt;
  return { body, syncedAt };
}

export async function saveKoreanGoldQuoteCache(
  admin: SupabaseClient,
  body: KoreanGoldQuoteResponse,
): Promise<void> {
  const { error } = await admin.from("korean_gold_quote_cache").upsert(
    {
      id: KOREAN_GOLD_QUOTE_CACHE_ID,
      payload: { ...body, stale: undefined },
      quote_at: body.quoteAt,
      fetched_at: body.fetchedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    console.error("[korean-gold-quotes] save cache failed", error);
  }
}

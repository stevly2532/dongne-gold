/** GitHub Actions가 커밋한 fallback — Vercel 재배포 없이 raw URL로 즉시 반영 */
export const KOREAN_GOLD_QUOTE_RAW_GITHUB_URL =
  "https://YOUR-SITE.vercel.app/korean-gold-quote-fallback.json";

/** GitHub ingest → Supabase 캐시가 이 시간 이내면 실시간 시세로 간주 */
export const KOREAN_GOLD_QUOTE_SYNC_FRESH_MS = 90_000;

/** 매장 PC 로컬 프록시 — 고객화면 PC에서 scripts/local-korean-gold-proxy.mjs 실행 시 */
export const KOREAN_GOLD_QUOTE_LOCAL_PROXY_URL = "http://127.0.0.1:3941/quote";

export function isKoreanGoldQuoteSyncFresh(
  syncedAt: string | null | undefined,
): boolean {
  if (!syncedAt?.trim()) return false;
  const ageMs = Date.now() - Date.parse(syncedAt);
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < KOREAN_GOLD_QUOTE_SYNC_FRESH_MS;
}

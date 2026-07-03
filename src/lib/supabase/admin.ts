/**
 * 서버 전용 Supabase 클라이언트 (service role 키 사용).
 *
 * - RLS 를 우회하므로 절대 클라이언트(브라우저) 코드에서 import 하지 말 것.
 * - 환경 변수 `SUPABASE_SERVICE_ROLE_KEY` 가 설정되지 않으면 `null` 을 반환한다.
 *   호출부는 null 체크 후 조용히 skip 해 개발 환경/키 누락 상황에서 빌드·런타임을 깨지 않게 한다.
 * - 현재 용도: `/api/korean-gold-prices` 가 한국금시세를 받았을 때 `daily_purchase_prices` 자동 갱신.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "gold-ledger-admin" },
    },
  });
  return cached;
}

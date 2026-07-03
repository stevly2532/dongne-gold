import type { SupabaseClient } from "@supabase/supabase-js";

const IMAGE_BUCKET = "labor-fee-images";
/** Storage signed URL 유효 시간(초) */
const SIGNED_TTL_SEC = 60 * 60 * 24;
/** 만료 1시간 전이면 재발급 */
const CACHE_REFRESH_BEFORE_MS = 60 * 60 * 1000;
const MAX_CONCURRENT = 12;

type CacheEntry = { url: string; expiresAt: number };

const urlCache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<string | null>>();

let activeCount = 0;
const waitQueue: Array<() => void> = [];

function drainQueue() {
  while (activeCount < MAX_CONCURRENT && waitQueue.length > 0) {
    const job = waitQueue.shift();
    job?.();
  }
}

function runLimited<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    waitQueue.push(() => {
      activeCount += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeCount -= 1;
          drainQueue();
        });
    });
    drainQueue();
  });
}

export function getCachedLaborFeeImageUrl(imagePath: string): string | null {
  const entry = urlCache.get(imagePath);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt - CACHE_REFRESH_BEFORE_MS) {
    urlCache.delete(imagePath);
    return null;
  }
  return entry.url;
}

export function setCachedLaborFeeImageUrl(imagePath: string, url: string) {
  urlCache.set(imagePath, {
    url,
    expiresAt: Date.now() + SIGNED_TTL_SEC * 1000,
  });
}

export function invalidateLaborFeeImageUrl(imagePath: string) {
  urlCache.delete(imagePath);
  pending.delete(imagePath);
}

export async function fetchLaborFeeImageUrl(
  supabase: SupabaseClient,
  imagePath: string,
): Promise<string | null> {
  const cached = getCachedLaborFeeImageUrl(imagePath);
  if (cached) return cached;

  const inflight = pending.get(imagePath);
  if (inflight) return inflight;

  const promise = runLimited(async () => {
    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(imagePath, SIGNED_TTL_SEC);
    pending.delete(imagePath);
    if (error || !data?.signedUrl) return null;
    setCachedLaborFeeImageUrl(imagePath, data.signedUrl);
    return data.signedUrl;
  });

  pending.set(imagePath, promise);
  return promise;
}

/** 화면 상단(먼저 보이는) 사진 URL을 미리 발급해 캐시에 넣는다. */
export function prefetchLaborFeeImageUrls(
  supabase: SupabaseClient,
  imagePaths: string[],
) {
  const unique = [...new Set(imagePaths.map((p) => p.trim()).filter(Boolean))];
  for (const path of unique) {
    if (getCachedLaborFeeImageUrl(path)) continue;
    void fetchLaborFeeImageUrl(supabase, path);
  }
}

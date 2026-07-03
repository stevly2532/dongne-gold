type CacheEntry<T> = {
  value: T;
  updatedAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string, ttlMs: number): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (ttlMs > 0 && Date.now() - hit.updatedAt > ttlMs) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T) {
  store.set(key, { value, updatedAt: Date.now() });
}

export function cacheInvalidate(prefix: string) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/**
 * Stale-while-revalidate helper.
 * - If cache hit exists, returns it immediately and revalidates in background.
 * - If cache miss, waits for fetcher and then caches.
 */
export async function swrLoad<T>(opts: {
  key: string;
  ttlMs: number;
  fetcher: () => Promise<T>;
  onHit?: (value: T, meta: { stale: boolean }) => void;
  onFresh: (value: T) => void;
  onError?: (err: unknown) => void;
}) {
  const cached = cacheGet<T>(opts.key, opts.ttlMs);
  if (cached != null) {
    opts.onHit?.(cached, { stale: true });
    void (async () => {
      try {
        const fresh = await opts.fetcher();
        cacheSet(opts.key, fresh);
        opts.onFresh(fresh);
      } catch (e) {
        opts.onError?.(e);
      }
    })();
    return;
  }

  try {
    const fresh = await opts.fetcher();
    cacheSet(opts.key, fresh);
    opts.onFresh(fresh);
  } catch (e) {
    opts.onError?.(e);
  }
}


/**
 * 시세 라인업 파싱·매장 마진 적용.
 * 기본 upstream: 한국표준금거래소(goldgold.co.kr) — route.ts 에서 우선 fetch.
 * koreagoldx 는 클라우드 IP 403 시 fallback.
 */

export const KOREAN_GOLD_MAIN_API = "https://www.koreagoldx.co.kr/api/main";
export const KOREAN_GOLD_HOME_URL = "https://www.koreagoldx.co.kr/";
export const KOREAN_GOLD_FETCH_TIMEOUT_MS = 12_000;

function koreanGoldProxyUrl(): string | undefined {
  const url = process.env.KOREAN_GOLD_PROXY_URL?.trim();
  return url || undefined;
}

function koreanGoldProxyToken(): string | undefined {
  const token = process.env.KOREAN_GOLD_PROXY_TOKEN?.trim();
  return token || undefined;
}

/** 한국표준금거래소 "내가 팔 때"에 더해서 매장 자사 매입가로 노출할 금액(원/돈). */
export const GOLD_MARGIN_KRW = 1_000;

export type KoreanGoldQuoteRow = {
  buy: number | null;
  buyDeltaPct: number | null;
  buyDeltaAmt: number | null;
  sell: number | null;
  sellDeltaPct: number | null;
  sellDeltaAmt: number | null;
};

export type KoreanGoldQuoteResponse = {
  ok: true;
  fetchedAt: string;
  quoteAt: string | null;
  rows: {
    pure: KoreanGoldQuoteRow;
    k18: KoreanGoldQuoteRow;
    k14: KoreanGoldQuoteRow;
    white: KoreanGoldQuoteRow;
    silver: KoreanGoldQuoteRow;
  };
  /** upstream 실패 후 DB 캐시를 돌려줄 때 true */
  stale?: boolean;
};

export type KoreanGoldQuoteErrorResponse = {
  ok: false;
  error: string;
};

type OfficialPrice4Raw = {
  date?: string;
  s_pure?: number;
  p_pure?: number;
  per_s_pure?: number;
  per_p_pure?: number;
  turm_s_pure?: number;
  turm_p_pure?: number;
  s_18k?: number;
  p_18k?: number;
  per_s_18k?: number;
  per_p_18k?: number;
  turm_s_18k?: number;
  turm_p_18k?: number;
  s_14k?: number;
  p_14k?: number;
  per_s_14k?: number;
  per_p_14k?: number;
  turm_s_14k?: number;
  turm_p_14k?: number;
  s_white?: number;
  p_white?: number;
  per_s_white?: number;
  per_p_white?: number;
  turm_s_white?: number;
  turm_p_white?: number;
  s_silver?: number;
  p_silver?: number;
  per_s_silver?: number;
  per_p_silver?: number;
  turm_s_silver?: number;
  turm_p_silver?: number;
};

function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function roundToNearest1000(n: number): number {
  return Math.round(n / 1000) * 1000;
}

function applyStoreMargin(raw: number | null): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return raw;
  return roundToNearest1000(raw + GOLD_MARGIN_KRW);
}

function pickRow(
  o: OfficialPrice4Raw,
  prefix: "pure" | "18k" | "14k" | "white" | "silver",
): KoreanGoldQuoteRow {
  return {
    buy: num((o as Record<string, unknown>)[`s_${prefix}`]),
    buyDeltaPct: num((o as Record<string, unknown>)[`per_s_${prefix}`]),
    buyDeltaAmt: num((o as Record<string, unknown>)[`turm_s_${prefix}`]),
    sell: num((o as Record<string, unknown>)[`p_${prefix}`]),
    sellDeltaPct: num((o as Record<string, unknown>)[`per_p_${prefix}`]),
    sellDeltaAmt: num((o as Record<string, unknown>)[`turm_p_${prefix}`]),
  };
}

export function buildKoreanGoldQuoteResponse(
  o: OfficialPrice4Raw,
  fetchedAt: string,
  options?: { stale?: boolean },
): KoreanGoldQuoteResponse {
  const rows = {
    pure: pickRow(o, "pure"),
    k18: pickRow(o, "18k"),
    k14: pickRow(o, "14k"),
    white: pickRow(o, "white"),
    silver: pickRow(o, "silver"),
  };

  rows.pure = { ...rows.pure, sell: applyStoreMargin(rows.pure.sell) };
  rows.k18 = { ...rows.k18, sell: applyStoreMargin(rows.k18.sell) };
  rows.k14 = { ...rows.k14, sell: applyStoreMargin(rows.k14.sell) };

  return {
    ok: true,
    fetchedAt,
    quoteAt: typeof o.date === "string" ? o.date : null,
    rows,
    ...(options?.stale ? { stale: true } : {}),
  };
}

export function upstreamFetchHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: "https://www.koreagoldx.co.kr",
    Referer: "https://www.koreagoldx.co.kr/",
    "X-Requested-With": "XMLHttpRequest",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

/** koreagoldx WAF: /api/main 은 메인 페이지 쿠키(AWSALB) 없으면 403. 브라우저와 동일하게 선행 GET. */
function parseSetCookieHeader(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers
      .getSetCookie()
      .map((c) => c.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");
  }
  const single = res.headers.get("set-cookie");
  if (!single) return "";
  return single
    .split(/,(?=\s*[^;,]+=)/)
    .map((c) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function fetchKoreanGoldSessionCookie(signal: AbortSignal): Promise<string> {
  const home = await fetch(KOREAN_GOLD_HOME_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    redirect: "follow",
    cache: "no-store",
    signal,
  });
  if (!home.ok) return "";
  return parseSetCookieHeader(home);
}

export async function fetchKoreanGoldOfficialPrice4(): Promise<
  | {
      ok: true;
      officialPrice4: OfficialPrice4Raw;
    }
  | {
      ok: false;
      status: number;
      error: string;
    }
> {
  const proxyUrl = koreanGoldProxyUrl();
  if (proxyUrl) {
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      const token = koreanGoldProxyToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const proxy = await fetch(proxyUrl, { headers, cache: "no-store" });
      if (!proxy.ok) {
        return { ok: false, status: proxy.status, error: `proxy ${proxy.status}` };
      }
      const json = (await proxy.json()) as { officialPrice4?: OfficialPrice4Raw };
      const o = json.officialPrice4;
      if (!o || typeof o !== "object") {
        return { ok: false, status: 502, error: "proxy missing officialPrice4" };
      }
      return { ok: true, officialPrice4: o };
    } catch (err) {
      return {
        ok: false,
        status: 502,
        error: err instanceof Error ? err.message : "proxy fetch failed",
      };
    }
  }

  let lastStatus = 502;
  let lastError = "fetch failed";

  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), KOREAN_GOLD_FETCH_TIMEOUT_MS);
    try {
      const cookie = await fetchKoreanGoldSessionCookie(ctrl.signal);
      const upstream = await fetch(KOREAN_GOLD_MAIN_API, {
        method: "POST",
        headers: upstreamFetchHeaders(cookie || undefined),
        body: "{}",
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (!upstream.ok) {
        lastStatus = upstream.status;
        lastError = `upstream ${upstream.status}`;
        continue;
      }
      const json = (await upstream.json()) as { officialPrice4?: OfficialPrice4Raw };
      const o = json.officialPrice4;
      if (!o || typeof o !== "object") {
        lastStatus = 502;
        lastError = "missing officialPrice4";
        continue;
      }
      return { ok: true, officialPrice4: o };
    } catch (err) {
      lastStatus = 502;
      lastError = err instanceof Error ? err.message : "fetch failed";
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, status: lastStatus, error: lastError };
}

export function todayYmdSeoul(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

/** officialPrice4.date / quoteAt → YYYY-MM-DD (한국일) */
export function quoteAtYmdSeoul(quoteAt: string | null | undefined): string | null {
  if (!quoteAt?.trim()) return null;
  const m = quoteAt.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function isQuoteAtTodaySeoul(quoteAt: string | null | undefined): boolean {
  const ymd = quoteAtYmdSeoul(quoteAt);
  return ymd != null && ymd === todayYmdSeoul();
}

/** officialPrice4.date "2026-06-23 09:51:31" → ms (비교용) */
export function koreanGoldQuoteAtMs(quoteAt: string | null | undefined): number {
  if (!quoteAt?.trim()) return 0;
  const isoish = quoteAt.trim().replace(" ", "T");
  const ms = Date.parse(isoish);
  return Number.isFinite(ms) ? ms : 0;
}

export function pickNewestKoreanGoldQuote(
  candidates: Array<KoreanGoldQuoteResponse | null | undefined>,
): KoreanGoldQuoteResponse | null {
  let best: KoreanGoldQuoteResponse | null = null;
  let bestMs = 0;
  for (const c of candidates) {
    if (!c?.ok || !c.rows) continue;
    const ms = koreanGoldQuoteAtMs(c.quoteAt);
    if (ms > bestMs) {
      bestMs = ms;
      best = c;
    }
  }
  return best;
}

const QUOTE_ROW_KEYS = ["pure", "k18", "k14", "white", "silver"] as const;

/** 시세 본문이 바뀌었는지(quoteAt·매수/매도가) 판별 */
export function koreanGoldQuoteSignature(body: KoreanGoldQuoteResponse): string {
  const parts: string[] = [body.quoteAt ?? ""];
  for (const key of QUOTE_ROW_KEYS) {
    const row = body.rows[key];
    parts.push(String(row.sell ?? ""), String(row.buy ?? ""));
  }
  return parts.join("|");
}

export function koreanGoldQuotesEqual(
  a: KoreanGoldQuoteResponse,
  b: KoreanGoldQuoteResponse,
): boolean {
  return koreanGoldQuoteSignature(a) === koreanGoldQuoteSignature(b);
}

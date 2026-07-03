/**
 * 한국금시세 프록시 — Vercel/GitHub Actions IP 403 우회.
 * Cloudflare Workers에서 koreagoldx.co.kr/api/main 을 대신 호출한다.
 */

const KOREAN_GOLD_HOME = "https://www.koreagoldx.co.kr/";
const KOREAN_GOLD_MAIN_API = "https://www.koreagoldx.co.kr/api/main";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function corsHeaders(origin) {
  const allow =
    origin && /^(https:\/\/gold-ledger-a9z6\.vercel\.app|http:\/\/localhost(:\d+)?)$/.test(origin)
      ? origin
      : "https://YOUR-SITE.vercel.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  };
}

function parseSetCookie(res) {
  const cookies = res.headers.getSetCookie?.() ?? [];
  if (cookies.length) {
    return cookies
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

async function fetchOfficialPrice4() {
  const home = await fetch(KOREAN_GOLD_HOME, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    redirect: "follow",
  });
  const cookie = home.ok ? parseSetCookie(home) : "";
  const headers = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: "https://www.koreagoldx.co.kr",
    Referer: "https://www.koreagoldx.co.kr/",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(KOREAN_GOLD_MAIN_API, {
    method: "POST",
    headers,
    body: "{}",
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const json = await res.json();
  const o = json?.officialPrice4;
  if (!o || typeof o !== "object") {
    return { ok: false, status: 502 };
  }
  return { ok: true, officialPrice4: o };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const base = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: base });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/api/main") {
      return new Response("not found", { status: 404, headers: base });
    }

    const token = env.PROXY_TOKEN?.trim();
    if (token) {
      const auth = request.headers.get("Authorization")?.trim();
      if (auth !== `Bearer ${token}`) {
        return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
          status: 401,
          headers: { ...base, "Content-Type": "application/json" },
        });
      }
    }

    const upstream = await fetchOfficialPrice4();
    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ ok: false, status: upstream.status }),
        { status: 502, headers: { ...base, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, officialPrice4: upstream.officialPrice4 }),
      { headers: { ...base, "Content-Type": "application/json" } },
    );
  },
};

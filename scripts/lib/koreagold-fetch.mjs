const KOREAN_GOLD_HOME = "https://www.koreagoldx.co.kr/";
const KOREAN_GOLD_MAIN_API = "https://www.koreagoldx.co.kr/api/main";
const KOREAN_GOLD_PROXY_URL = process.env.KOREAN_GOLD_PROXY_URL?.trim() || "";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function parseSetCookieHeader(res) {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers
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

async function fetchSessionCookie() {
  const home = await fetch(KOREAN_GOLD_HOME, {
    headers: {
      "User-Agent": UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    redirect: "follow",
  });
  if (!home.ok) return "";
  return parseSetCookieHeader(home);
}

/** @returns {Promise<{ ok: true, officialPrice4: object } | { ok: false, status: number }>} */
export async function fetchKoreanGoldOfficialPrice4() {
  if (KOREAN_GOLD_PROXY_URL) {
    const headers = { Accept: "application/json" };
    const token = process.env.KOREAN_GOLD_PROXY_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const proxy = await fetch(KOREAN_GOLD_PROXY_URL, { headers, cache: "no-store" });
    if (!proxy.ok) return { ok: false, status: proxy.status };
    const json = await proxy.json();
    const o = json.officialPrice4;
    if (!o || typeof o !== "object") return { ok: false, status: 502 };
    return { ok: true, officialPrice4: o };
  }

  const cookie = await fetchSessionCookie();
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
  if (!res.ok) return { ok: false, status: res.status };
  const json = await res.json();
  const o = json.officialPrice4;
  if (!o || typeof o !== "object") return { ok: false, status: 502 };
  return { ok: true, officialPrice4: o };
}

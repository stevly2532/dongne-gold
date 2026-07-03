/**
 * 매장 고객화면 PC용 로컬 프록시.
 * 한국금거래소는 Vercel/GitHub/Cloudflare IP를 403 — 매장(가정) IP에서는 정상.
 * 이 스크립트를 고객화면 PC에서 실행하면 30초마다 시세 fetch + Vercel ingest.
 *
 *   node scripts/local-korean-gold-proxy.mjs
 *
 * 고객화면 브라우저는 http://127.0.0.1:3941/quote 를 30초마다 폴링.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fetchKoreanGoldOfficialPrice4 } from "./lib/koreagold-fetch.mjs";

const PORT = Number(process.env.KOREAN_GOLD_LOCAL_PROXY_PORT || 3941);
const HOST = "127.0.0.1";
const POLL_MS = Number(process.env.KOREAN_GOLD_LOCAL_PROXY_POLL_MS || 30_000);
const GOLD_MARGIN_KRW = 2000;
const DEFAULT_INGEST_URL =
  "https://YOUR-SITE.vercel.app/api/korean-gold-prices/ingest";

const ALLOW_ORIGIN = "https://YOUR-SITE.vercel.app";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));

function roundToNearest1000(n) {
  return Math.round(n / 1000) * 1000;
}

function applyStoreMargin(raw) {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return raw;
  return roundToNearest1000(raw + GOLD_MARGIN_KRW);
}

function num(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function pickRow(o, prefix) {
  return {
    buy: num(o[`s_${prefix}`]),
    buyDeltaPct: num(o[`per_s_${prefix}`]),
    buyDeltaAmt: num(o[`turm_s_${prefix}`]),
    sell: num(o[`p_${prefix}`]),
    sellDeltaPct: num(o[`per_p_${prefix}`]),
    sellDeltaAmt: num(o[`turm_p_${prefix}`]),
  };
}

function buildResponse(o, fetchedAt) {
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
  };
}

let latest = null;
let pollTimer = null;

async function refreshQuote() {
  const upstream = await fetchKoreanGoldOfficialPrice4();
  if (!upstream.ok) {
    console.warn("[local-proxy] upstream failed", upstream.status);
    return false;
  }
  const fetchedAt = new Date().toISOString();
  latest = buildResponse(upstream.officialPrice4, fetchedAt);
  console.log(
    "[local-proxy]",
    latest.quoteAt ?? "",
    "순금",
    latest.rows.pure.sell?.toLocaleString("ko-KR"),
  );

  const secret = process.env.KOREAN_GOLD_SYNC_SECRET?.trim();
  const ingestUrl = process.env.KOREAN_GOLD_INGEST_URL || DEFAULT_INGEST_URL;
  if (secret) {
    try {
      const res = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(latest),
      });
      if (!res.ok) {
        console.warn("[local-proxy] ingest failed", res.status, await res.text());
      }
    } catch (e) {
      console.warn("[local-proxy] ingest error", e);
    }
  }
  return true;
}

function cors(res, origin) {
  const allow =
    origin === ALLOW_ORIGIN ||
    origin === "http://localhost:3000" ||
    origin?.startsWith("http://127.0.0.1:")
      ? origin
      : ALLOW_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

const server = createServer((req, res) => {
  const origin = req.headers.origin ?? "";
  cors(res, origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, hasQuote: latest != null }));
    return;
  }

  if (req.url === "/quote" || req.url === "/") {
    if (!latest) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "no quote yet" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(latest));
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, HOST, () => {
  console.log(`[local-proxy] http://${HOST}:${PORT}/quote (${POLL_MS / 1000}s poll)`);
  void refreshQuote();
  pollTimer = setInterval(() => void refreshQuote(), POLL_MS);
});

process.on("SIGINT", () => {
  if (pollTimer) clearInterval(pollTimer);
  server.close();
  process.exit(0);
});

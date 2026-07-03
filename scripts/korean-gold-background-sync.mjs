/**
 * 매장 PC 백그라운드 — 30초마다 한국금거래소 → Supabase ingest.
 * 고객화면·핸드폰은 /api/korean-gold-prices 만 폴링 (예전과 동일).
 * 창 없이 로그인 시 자동 실행 (install-korean-gold-sync-task.ps1).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fetchKoreanGoldQuoteUpstream } from "./lib/fetch-korean-gold-upstream.mjs";

const POLL_MS = 30_000;
const GOLD_MARGIN_KRW = 1000;
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

async function syncOnce() {
  const secret = process.env.KOREAN_GOLD_SYNC_SECRET?.trim();
  if (!secret) {
    console.warn("[korean-gold-sync] KOREAN_GOLD_SYNC_SECRET 없음");
    return;
  }

  const upstream = await fetchKoreanGoldQuoteUpstream();
  if (!upstream.ok) {
    console.warn("[korean-gold-sync] upstream", upstream.status, upstream.error);
    return;
  }

  const body = buildResponse(upstream.officialPrice4, new Date().toISOString());
  const ingestUrl = process.env.KOREAN_GOLD_INGEST_URL?.trim();

  const res = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.warn("[korean-gold-sync] ingest", res.status, await res.text());
    return;
  }

  console.log(
    "[korean-gold-sync]",
    body.quoteAt ?? "",
    "순금",
    body.rows.pure.sell?.toLocaleString("ko-KR"),
  );
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    await syncOnce();
  } catch (e) {
    console.warn("[korean-gold-sync] error", e);
  } finally {
    busy = false;
  }
}

console.log(`[korean-gold-sync] 30초 주기 시작 (${POLL_MS / 1000}s)`);
void tick();
setInterval(() => void tick(), POLL_MS);

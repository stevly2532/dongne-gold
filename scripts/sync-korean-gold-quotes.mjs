/**
 * 한국금시세를 로컬/GitHub Actions에서 받아 Supabase 캐시·매입시세에 저장.
 * Vercel 서버 IP는 koreagoldx 403 이라 이 스크립트로 주기 갱신이 필요하다.
 *
 * 필요 env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (또는 .env.local)
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchKoreanGoldQuoteUpstream } from "./lib/fetch-korean-gold-upstream.mjs";

const GOLD_MARGIN_KRW = 1000;
const CACHE_ID = "latest";

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
loadEnvFile(resolve(process.cwd(), ".env"));

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

function todayYmdSeoul() {
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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요");
    process.exit(1);
  }

  const upstream = await fetchKoreanGoldQuoteUpstream();
  if (!upstream.ok) {
    console.error("upstream failed:", upstream.status, upstream.error);
    process.exit(1);
  }

  const o = upstream.officialPrice4;

  const fetchedAt = new Date().toISOString();
  const body = buildResponse(o, fetchedAt);
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: cacheErr } = await admin.from("korean_gold_quote_cache").upsert(
    {
      id: CACHE_ID,
      payload: body,
      quote_at: body.quoteAt,
      fetched_at: body.fetchedAt,
      updated_at: fetchedAt,
    },
    { onConflict: "id" },
  );
  if (cacheErr) {
    console.error("cache upsert failed:", cacheErr.message);
    console.error(
      "Supabase SQL Editor에서 supabase/migration_korean_gold_quote_cache.sql 실행 필요",
    );
    process.exit(1);
  }

  try {
    writeFileSync(
      resolve(process.cwd(), "public/korean-gold-quote-fallback.json"),
      `${JSON.stringify(body, null, 2)}\n`,
      "utf8",
    );
  } catch (e) {
    console.error("fallback file write failed:", e);
  }

  const goldSell = body.rows.pure.sell;
  if (goldSell != null && Number.isFinite(goldSell) && goldSell > 0) {
    const { error: priceErr } = await admin.from("daily_purchase_prices").upsert(
      {
        quote_date: todayYmdSeoul(),
        quote_scope: "gold",
        price_per_don: Math.round(goldSell),
        updated_at: fetchedAt,
        updated_by: null,
      },
      { onConflict: "quote_date,quote_scope" },
    );
    if (priceErr) {
      console.error("daily_purchase_prices upsert failed:", priceErr.message);
    }
  }

  console.log(
    "OK",
    body.quoteAt ?? "",
    "순금 매입",
    body.rows.pure.sell?.toLocaleString("ko-KR"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

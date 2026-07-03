/**
 * 한국금시세 fetch → Vercel ingest API → Supabase 실시간 캐시.
 * GitHub Actions(IP 허용)에서 실행. Supabase service_role 은 Vercel 쪽에만 둔다.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fetchKoreanGoldQuoteUpstream } from "./lib/fetch-korean-gold-upstream.mjs";

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

async function main() {
  const secret = process.env.KOREAN_GOLD_SYNC_SECRET?.trim();
  const ingestUrl = process.env.KOREAN_GOLD_INGEST_URL?.trim();
  const ingestUrl = process.env.KOREAN_GOLD_INGEST_URL?.trim();
  if (!ingestUrl) {
    console.error("KOREAN_GOLD_INGEST_URL 필요");
    process.exit(1);
  }
  if (!secret?.trim()) {
    console.error("KOREAN_GOLD_SYNC_SECRET 필요");
    process.exit(1);
  }

  const upstream = await fetchKoreanGoldQuoteUpstream();
  if (!upstream.ok) {
    console.error("upstream failed:", upstream.status, upstream.error);
    process.exit(1);
  }

  const fetchedAt = new Date().toISOString();
  const body = buildResponse(upstream.officialPrice4, fetchedAt);

  const res = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("ingest failed", res.status, text);
    process.exit(1);
  }

  console.log(
    "ingest OK",
    body.quoteAt ?? "",
    "순금",
    body.rows.pure.sell?.toLocaleString("ko-KR"),
    text,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

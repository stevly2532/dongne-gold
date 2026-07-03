/**
 * 한국표준금거래소 → public/korean-gold-quote-fallback.json 갱신.
 * Vercel 빌드·로컬 prebuild 에서 실행. 실패해도 기존 fallback 파일로 배포는 계속된다.
 */

import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fetchGoldgoldOfficialPrice4 } from "./lib/goldgold-fetch.mjs";
const GOLD_MARGIN_KRW = 1000;
const OUT = resolve(process.cwd(), "public/korean-gold-quote-fallback.json");

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
  const upstream = await fetchGoldgoldOfficialPrice4();

  if (!upstream.ok) {
    if (existsSync(OUT)) {
      console.warn(
        `[update-quote-fallback] upstream ${upstream.status}, keeping existing file`,
      );
      return;
    }
    console.error(`[update-quote-fallback] upstream ${upstream.status}, no fallback file`);
    process.exit(1);
  }

  const o = upstream.officialPrice4;

  const body = buildResponse(o, new Date().toISOString());
  writeFileSync(OUT, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  console.log(
    "[update-quote-fallback] OK",
    body.quoteAt ?? "",
    "순금",
    body.rows.pure.sell?.toLocaleString("ko-KR"),
  );
}

main().catch((e) => {
  if (existsSync(OUT)) {
    console.warn("[update-quote-fallback] error, keeping existing file:", e.message);
    return;
  }
  console.error(e);
  process.exit(1);
});

/**
 * 한국표준금거래소 indexPrice API — 빌드·스크립트용.
 */

const GOLDGOLD_INDEX_PRICE_API =
  "https://irena111.cafe24.com/api/goldgold/mapper.indexPrice.php";

function parseY(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapDeltaPct(rawPer, rawAmt) {
  const per = parseY(rawPer);
  const amt = parseY(rawAmt);
  if (per == null) return null;
  if (amt == null || amt === 0) return per;
  return amt < 0 ? -Math.abs(per) : Math.abs(per);
}

function mapIndexPriceToOfficial(o) {
  const quoteDate = o.t_gold_date?.trim() || "";
  return {
    date: quoteDate ? `${quoteDate} 00:00:00` : null,
    s_pure: parseY(o.t_gold_b_24) ?? undefined,
    p_pure: parseY(o.t_gold_s_24) ?? undefined,
    per_s_pure: mapDeltaPct(o.ty_gold_b_24_per, o.ty_gold_b_24) ?? undefined,
    turm_s_pure: parseY(o.ty_gold_b_24) ?? undefined,
    per_p_pure: mapDeltaPct(o.ty_gold_s_24_per, o.ty_gold_s_24) ?? undefined,
    turm_p_pure: parseY(o.ty_gold_s_24) ?? undefined,
    p_18k: parseY(o.t_gold_s_18) ?? undefined,
    per_p_18k: mapDeltaPct(o.ty_gold_s_18_per, o.ty_gold_s_18) ?? undefined,
    turm_p_18k: parseY(o.ty_gold_s_18) ?? undefined,
    p_14k: parseY(o.t_gold_s_14) ?? undefined,
    per_p_14k: mapDeltaPct(o.ty_gold_s_14_per, o.ty_gold_s_14) ?? undefined,
    turm_p_14k: parseY(o.ty_gold_s_14) ?? undefined,
    s_white: parseY(o.t_pla_price_b) ?? undefined,
    p_white: parseY(o.t_pla_price_s) ?? undefined,
    per_s_white: mapDeltaPct(o.ty_pla_price_b_per, o.ty_pla_price_b) ?? undefined,
    turm_s_white: parseY(o.ty_pla_price_b) ?? undefined,
    per_p_white: mapDeltaPct(o.ty_pla_price_s_per, o.ty_pla_price_s) ?? undefined,
    turm_p_white: parseY(o.ty_pla_price_s) ?? undefined,
    s_silver: parseY(o.t_silver_b) ?? undefined,
    p_silver: parseY(o.t_silver_s) ?? undefined,
    per_s_silver: mapDeltaPct(o.ty_silver_b_per, o.ty_silver_b) ?? undefined,
    turm_s_silver: parseY(o.ty_silver_b) ?? undefined,
    per_p_silver: mapDeltaPct(o.ty_silver_s_per, o.ty_silver_s) ?? undefined,
    turm_p_silver: parseY(o.ty_silver_s) ?? undefined,
  };
}

export async function fetchGoldgoldOfficialPrice4() {
  try {
    const res = await fetch(GOLDGOLD_INDEX_PRICE_API, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `goldgold ${res.status}` };
    }
    const json = await res.json();
    const sell = parseY(json.t_gold_s_24);
    const buy = parseY(json.t_gold_b_24);
    if (sell == null && buy == null) {
      return { ok: false, status: 502, error: "goldgold missing quote" };
    }
    return { ok: true, officialPrice4: mapIndexPriceToOfficial(json) };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "goldgold fetch failed",
    };
  }
}

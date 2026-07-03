import { todayYmdSeoul } from "@/lib/koreanGoldQuotes";

export type GoldgoldIndexPriceRaw = {
  t_gold_date?: string;
  t_gold_b_24?: string | number;
  t_gold_s_24?: string | number;
  t_gold_s_18?: string | number;
  t_gold_s_14?: string | number;
  t_silver_b?: string | number;
  t_silver_s?: string | number;
  t_pla_price_b?: string | number;
  t_pla_price_s?: string | number;
  ty_gold_b_24?: string | number;
  ty_gold_b_24_per?: string | number;
  ty_gold_s_24?: string | number;
  ty_gold_s_24_per?: string | number;
  ty_gold_s_18?: string | number;
  ty_gold_s_18_per?: string | number;
  ty_gold_s_14?: string | number;
  ty_gold_s_14_per?: string | number;
  ty_silver_b?: string | number;
  ty_silver_b_per?: string | number;
  ty_silver_s?: string | number;
  ty_silver_s_per?: string | number;
  ty_pla_price_b?: string | number;
  ty_pla_price_b_per?: string | number;
  ty_pla_price_s?: string | number;
  ty_pla_price_s_per?: string | number;
};

export type GoldgoldOfficialPrice4Raw = {
  date?: string;
  s_pure?: number;
  p_pure?: number;
  per_s_pure?: number;
  turm_s_pure?: number;
  per_p_pure?: number;
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

function parseY(v: string | number | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapDeltaPct(
  rawPer: string | number | undefined,
  rawAmt: string | number | undefined,
): number | null {
  const per = parseY(rawPer);
  const amt = parseY(rawAmt);
  if (per == null) return null;
  if (amt == null || amt === 0) return per;
  return amt < 0 ? -Math.abs(per) : Math.abs(per);
}

function quoteAtFromGoldDate(ymd: string | undefined): string | null {
  if (!ymd?.trim()) return null;
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} 00:00:00`;
}

export function parseGoldgoldIndexPriceJson(
  o: GoldgoldIndexPriceRaw,
): GoldgoldOfficialPrice4Raw {
  const quoteDate = o.t_gold_date?.trim() || todayYmdSeoul();
  return {
    date: quoteAtFromGoldDate(quoteDate) ?? `${quoteDate} 00:00:00`,
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

export function goldgoldIndexPriceHasQuote(o: GoldgoldIndexPriceRaw): boolean {
  const sell = parseY(o.t_gold_s_24);
  const buy = parseY(o.t_gold_b_24);
  return sell != null || buy != null;
}

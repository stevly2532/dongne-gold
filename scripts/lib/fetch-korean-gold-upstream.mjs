import { fetchGoldgoldOfficialPrice4 } from "./goldgold-fetch.mjs";
import { fetchKoreanGoldOfficialPrice4 } from "./koreagold-fetch.mjs";

/** goldgold 우선, 실패 시 koreagoldx (Vercel·GHA 공통) */
export async function fetchKoreanGoldQuoteUpstream() {
  const goldgold = await fetchGoldgoldOfficialPrice4();
  if (goldgold.ok) return goldgold;
  return fetchKoreanGoldOfficialPrice4();
}

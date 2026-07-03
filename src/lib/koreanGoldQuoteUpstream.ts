import { fetchGoldgoldOfficialPrice4 } from "@/lib/goldgoldKgsQuotes";
import { fetchKoreanGoldOfficialPrice4 } from "@/lib/koreanGoldQuotes";

export type KoreanGoldUpstreamSource = "goldgold" | "koreagoldx";

type OfficialPrice4Raw = NonNullable<
  Awaited<ReturnType<typeof fetchGoldgoldOfficialPrice4>> extends infer R
    ? R extends { ok: true; officialPrice4: infer O }
      ? O
      : never
    : never
>;

export async function fetchKoreanGoldQuoteUpstream(): Promise<
  | { ok: true; officialPrice4: OfficialPrice4Raw; source: KoreanGoldUpstreamSource }
  | { ok: false; error: string }
> {
  const goldgold = await fetchGoldgoldOfficialPrice4();
  if (goldgold.ok) {
    return {
      ok: true,
      officialPrice4: goldgold.officialPrice4,
      source: "goldgold",
    };
  }

  const koreagoldx = await fetchKoreanGoldOfficialPrice4();
  if (koreagoldx.ok) {
    return {
      ok: true,
      officialPrice4: koreagoldx.officialPrice4,
      source: "koreagoldx",
    };
  }

  return {
    ok: false,
    error: `${goldgold.error}; ${koreagoldx.error}`,
  };
}

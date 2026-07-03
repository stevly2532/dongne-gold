import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncKoreanGoldQuoteIfChanged } from "@/lib/koreanGoldQuoteSync";
import {
  isQuoteAtTodaySeoul,
  type KoreanGoldQuoteResponse,
} from "@/lib/koreanGoldQuotes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidRelayBody(body: unknown): body is KoreanGoldQuoteResponse {
  if (!body || typeof body !== "object") return false;
  const b = body as KoreanGoldQuoteResponse;
  if (b.ok !== true || !b.rows?.pure) return false;
  const sell = b.rows.pure.sell;
  const buy = b.rows.pure.buy;
  if (sell != null && (!Number.isFinite(sell) || sell < 400_000 || sell > 2_000_000)) {
    return false;
  }
  if (buy != null && (!Number.isFinite(buy) || buy < 400_000 || buy > 2_000_000)) {
    return false;
  }
  return isQuoteAtTodaySeoul(b.quoteAt);
}

/** 고객화면 브라우저 → Supabase 캐시·매입시세 (클라우드 IP 403 우회) */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!isValidRelayBody(body)) {
    return NextResponse.json({ ok: false, error: "invalid quote" }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "admin unavailable" }, { status: 503 });
  }

  const payload: KoreanGoldQuoteResponse = {
    ...body,
    fetchedAt: new Date().toISOString(),
    stale: undefined,
  };

  try {
    const { cacheSaved, priceSaved } = await syncKoreanGoldQuoteIfChanged(
      admin,
      payload,
    );
    return NextResponse.json({
      ok: true,
      pureSell: payload.rows.pure.sell,
      skipped: !cacheSaved && !priceSaved,
    });
  } catch (e) {
    console.error("[korean-gold-prices/relay] sync threw", e);
    return NextResponse.json({ ok: false, error: "cache save failed" }, { status: 500 });
  }
}

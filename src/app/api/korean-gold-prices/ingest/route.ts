import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncKoreanGoldQuoteIfChanged } from "@/lib/koreanGoldQuoteSync";
import type { KoreanGoldQuoteResponse } from "@/lib/koreanGoldQuotes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidQuoteBody(body: unknown): body is KoreanGoldQuoteResponse {
  if (!body || typeof body !== "object") return false;
  const b = body as KoreanGoldQuoteResponse;
  return b.ok === true && b.rows != null && typeof b.rows === "object";
}

/** GitHub Actions → Vercel: 한국금시세를 Supabase에 밀어 넣음 (Vercel IP 403 우회) */
export async function POST(req: Request) {
  const expected = process.env.KOREAN_GOLD_SYNC_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ ok: false, error: "sync secret not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization")?.trim();
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!isValidQuoteBody(body)) {
    return NextResponse.json({ ok: false, error: "invalid quote payload" }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "admin client unavailable" }, { status: 503 });
  }

  const payload: KoreanGoldQuoteResponse = {
    ...body,
    fetchedAt: body.fetchedAt || new Date().toISOString(),
    stale: undefined,
  };

  try {
    const { cacheSaved, priceSaved } = await syncKoreanGoldQuoteIfChanged(
      admin,
      payload,
    );
    return NextResponse.json({
      ok: true,
      quoteAt: payload.quoteAt,
      pureSell: payload.rows.pure.sell,
      skipped: !cacheSaved && !priceSaved,
    });
  } catch (e) {
    console.error("[korean-gold-prices/ingest] sync threw", e);
    return NextResponse.json({ ok: false, error: "cache save failed" }, { status: 500 });
  }
}

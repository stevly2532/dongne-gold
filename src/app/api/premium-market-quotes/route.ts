import { NextResponse } from "next/server";
import { fetchPremiumMarketQuotes } from "@/lib/premiumMarketQuotes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const body = await fetchPremiumMarketQuotes();
  if (!body.ok) {
    return NextResponse.json(body, { status: 502 });
  }
  return NextResponse.json(body);
}

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 입고 완료 안내 문자 자동 발송 (솔라피/Solapi).
 *
 * - 로그인한 사용자만 호출 가능(Supabase 세션 확인).
 * - 환경변수 SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER 가 모두 있어야 실제 발송.
 *   하나라도 없으면 503 + code:"not_configured" → 클라이언트가 기존 "복사+안내"로 폴백.
 * - 솔라피는 IP 화이트리스트가 필요 없고 API키+HMAC 서명으로 인증해 Vercel과 잘 맞는다.
 *
 * 발신번호(SOLAPI_SENDER)는 솔라피 콘솔에서 사전등록(법적 의무)된 번호여야 한다.
 */

export const runtime = "nodejs";

const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send";

/** 솔라피 HMAC-SHA256 Authorization 헤더 생성 */
function buildSolapiAuthHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/** 숫자만 남긴 한국 휴대폰/전화번호 */
function onlyDigits(s: string): string {
  return (s || "").replace(/[^0-9]/g, "");
}

export async function POST(request: Request) {
  // 1) 로그인 확인
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "unauthorized", error: "로그인이 필요합니다." },
      { status: 401 },
    );
  }

  // 2) 입력 파싱
  let body: {
    phone?: unknown;
    message?: unknown;
    sourceScope?: unknown;
    sourceId?: unknown;
  };
  try {
    body = (await request.json()) as {
      phone?: unknown;
      message?: unknown;
      sourceScope?: unknown;
      sourceId?: unknown;
    };
  } catch {
    return NextResponse.json(
      { ok: false, code: "bad_request", error: "잘못된 요청입니다." },
      { status: 400 },
    );
  }
  const phone = onlyDigits(typeof body.phone === "string" ? body.phone : "");
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!phone || phone.length < 9) {
    return NextResponse.json(
      { ok: false, code: "bad_phone", error: "받는 번호가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (!message) {
    return NextResponse.json(
      { ok: false, code: "bad_message", error: "보낼 내용이 없습니다." },
      { status: 400 },
    );
  }

  // 3) 환경변수 확인 — 없으면 클라이언트가 폴백하도록 503
  //    값 끝의 공백·개행(CLI 입력 시 섞이기 쉬움)을 제거해야 HMAC 헤더가 깨지지 않는다.
  const apiKey = process.env.SOLAPI_API_KEY?.trim();
  const apiSecret = process.env.SOLAPI_API_SECRET?.trim();
  const sender = onlyDigits(process.env.SOLAPI_SENDER ?? "");
  if (!apiKey || !apiSecret || !sender) {
    return NextResponse.json(
      {
        ok: false,
        code: "not_configured",
        error: "문자 발송이 아직 설정되지 않았습니다.",
      },
      { status: 503 },
    );
  }

  // 4) 솔라피 발송
  try {
    const res = await fetch(SOLAPI_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: buildSolapiAuthHeader(apiKey, apiSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          to: phone,
          from: sender,
          text: message,
        },
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!res.ok) {
      const errMsg =
        (json && (json.errorMessage as string | undefined)) ||
        `발송 실패 (HTTP ${res.status})`;
      return NextResponse.json(
        { ok: false, code: "send_failed", error: errMsg, detail: json },
        { status: 502 },
      );
    }

    // 솔라피는 status/ statusCode 로 결과를 알려준다. 2000 계열이면 접수 성공.
    const statusCode =
      json && typeof json.statusCode === "string"
        ? (json.statusCode as string)
        : null;
    const failed =
      statusCode != null && !statusCode.startsWith("2") && statusCode !== "";
    if (failed) {
      return NextResponse.json(
        {
          ok: false,
          code: "send_rejected",
          error:
            (json?.statusMessage as string | undefined) ||
            "문자 발송이 거부되었습니다.",
          detail: json,
        },
        { status: 502 },
      );
    }

    const sourceScope =
      body.sourceScope === "inventory" || body.sourceScope === "as"
        ? body.sourceScope
        : null;
    const sourceId =
      typeof body.sourceId === "string" && body.sourceId.trim()
        ? body.sourceId.trim()
        : null;
    if (sourceScope && sourceId) {
      const { error: logErr } = await supabase.from("arrival_sms_log").insert({
        source_scope: sourceScope,
        source_id: sourceId,
        phone_digits: phone,
        message_body: message,
        sent_by: user.id,
      });
      if (logErr) {
        console.error("arrival_sms_log insert failed:", logErr.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        code: "send_error",
        error: e instanceof Error ? e.message : "발송 중 오류가 발생했습니다.",
      },
      { status: 502 },
    );
  }
}

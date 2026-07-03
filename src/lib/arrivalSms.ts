/**
 * 입고 완료 안내 문자(반자동) 공용 헬퍼.
 *
 * 외부 문자 발송 업체 없이 보낸다.
 *  - PC(데스크톱) + "휴대폰과 연결"(Phone Link): Phone Link는 번호·내용을 미리 채워 여는
 *    공식 딥링크가 없다. 그래서 문자 "내용"을 클립보드에 복사해 두고, 안내 토스트로 번호를
 *    띄운다 → 휴대폰과 연결에서 해당 대화창에 붙여넣기(Ctrl+V) 후 전송.
 *  - 폰/태블릿: sms: 링크로 문자앱이 번호·내용 채워진 채 열린다.
 * 매출(판매)·AS 장부에서 공통으로 사용한다.
 */

/** 입고 완료 안내 문자에 들어갈 상호명 */
export const ARRIVAL_SMS_STORE_NAME = "동네금빵";

export type ArrivalSmsContext = "sales" | "as";

/** 판매등록 제품코드(빠른선택) — 문자에 그대로 쓸 수 있는 한글 라벨 */
const SMS_PRODUCT_CODE_LABELS = [
  "골드바",
  "금덩어리",
  "목걸이",
  "팔찌",
  "반지",
  "귀걸이",
  "열쇠",
  "제품",
  "실버바 999.9",
] as const;

/** 제품코드에 "3돈 반지"처럼 중량이 붙어 있어도 문자에는 품목만 (긴 키워드 우선) */
const SMS_PRODUCT_KIND_KEYWORDS = [
  "실버바",
  "골드바",
  "금덩어리",
  "목걸이",
  "귀걸이",
  "팔찌",
  "반지",
  "열쇠",
] as const;

function isSmsPlaceholderCode(s: string): boolean {
  const t = s.trim();
  if (!t || t === "—" || t === "-") return true;
  if (t === "제품명" || t === "(제품명)") return true;
  return /^\(제품명\)$/i.test(t);
}

/**
 * 문자에 넣을 제품 표기 — 판매등록 제품코드(name)만 사용. 직접입력 제품명은 쓰지 않는다.
 * "3돈 반지", "5돈 골드바"처럼 중량이 붙어 있으면 반지·골드바만 남긴다.
 */
export function arrivalSmsProductLabel(
  productCode?: string | null,
): string {
  const code = productCode?.trim() ?? "";
  if (!code || isSmsPlaceholderCode(code)) return "제품";
  if (code === "실버바 999.9") return "실버바";
  if ((SMS_PRODUCT_CODE_LABELS as readonly string[]).includes(code)) {
    return code;
  }
  for (const kw of SMS_PRODUCT_KIND_KEYWORDS) {
    if (code.includes(kw)) return kw;
  }
  // 빠른선택 외 짧은 직접 입력(예: 열쇠) — 품목 키워드 없을 때만 통째로
  if (code.length <= 12) return code;
  return "제품";
}

/**
 * 입고 완료 안내 문자 본문 생성.
 * 매출: 제품코드 기준으로 "주문하신 반지" 형태. AS: 수리건 고정 문구.
 */
export function buildArrivalSmsBody(opts: {
  customerName?: string | null;
  /** inventory_items.name — 판매등록 제품코드만 사용 */
  productCode?: string | null;
  context?: ArrivalSmsContext;
}): string {
  const greeting = `안녕하세요 고객님 ${ARRIVAL_SMS_STORE_NAME}입니다 😄`;
  if (opts.context === "as") {
    return `${greeting}\n맡겨주신 수리건 입고 되었으니 시간나실때 방문해주세요 :D`;
  }
  const label = arrivalSmsProductLabel(opts.productCode);
  return `${greeting}\n주문하신 ${label} 입고 되었으니 시간나실때 방문해주세요 :D`;
}

/** 01012345678 → 010-1234-5678 (그 외 형태는 받은 그대로) */
function formatPhoneDisplay(digits: string): string {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

/** 화면 하단에 잠깐 떴다 사라지는 안내 토스트(인라인 스타일이라 어디서든 동작). */
function showArrivalToast(message: string): void {
  if (typeof document === "undefined") return;
  const el = document.createElement("div");
  el.textContent = message;
  el.setAttribute("role", "status");
  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    bottom: "28px",
    transform: "translateX(-50%)",
    zIndex: "99999",
    maxWidth: "min(92vw, 540px)",
    background: "#1c1917",
    color: "#ffffff",
    padding: "12px 18px",
    borderRadius: "12px",
    fontSize: "13.5px",
    lineHeight: "1.55",
    boxShadow: "0 10px 30px rgba(0,0,0,0.28)",
    whiteSpace: "pre-line",
    textAlign: "center",
    opacity: "0",
    transition: "opacity .25s ease",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
  });
  window.setTimeout(() => {
    el.style.opacity = "0";
  }, 6000);
  window.setTimeout(() => {
    el.remove();
  }, 6400);
}

/**
 * 솔라피 미설정/실패 시 폴백: 문자 내용을 클립보드에 복사하고 안내 토스트 + (모바일이면) 문자앱 열기.
 * @param failReason 자동발송이 "실패"한 경우의 사유(있으면 토스트 맨 위에 표시). 미설정/네트워크면 생략.
 */
function fallbackCopyAndOpen(
  digits: string,
  body: string,
  phoneDisp: string,
  failReason?: string,
) {
  void (async () => {
    let copied = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(body);
        copied = true;
      }
    } catch {
      copied = false;
    }

    const tail = copied
      ? `📋 입고 안내 문자를 복사했어요.\n‘휴대폰과 연결’에서 ${phoneDisp} 대화창에 붙여넣기(Ctrl+V) 후 보내세요.`
      : `${phoneDisp} 에게 보낼 내용:\n${body}`;
    showArrivalToast(failReason ? `⚠️ 자동발송 실패: ${failReason}\n${tail}` : tail);

    // 폰/태블릿이면 문자앱을 번호·내용 채운 채로 연다(PC에선 보통 무시됨).
    try {
      if (typeof window !== "undefined") {
        window.location.href = `sms:${digits}?body=${encodeURIComponent(body)}`;
      }
    } catch {
      /* ignore */
    }
  })();
}

/**
 * 입고 완료 안내 문자 전송.
 *  1) 서버(/api/send-arrival-sms, 솔라피)로 자동 발송 시도 → 성공이면 onSent() 호출 후 끝(토스트만).
 *  2) 미설정(키 없음)·실패·네트워크 오류면 기존 "복사 + 안내(+모바일 문자앱)" 폴백.
 * 호출부는 동기처럼 쓰면 된다(내부에서 비동기 처리).
 * @param onSent 솔라피가 발송을 확인했을 때만 호출(발송 여부 표시·저장용). 폴백/실패 시엔 호출 안 됨.
 * @param meta 발송 이력 저장용(매출 inventory / AS 장부 행 id).
 * @returns 번호가 유효하면 true.
 */
export type ArrivalSmsSourceScope = "inventory" | "as";

export function openArrivalSms(
  phoneRaw: string,
  body: string,
  onSent?: () => void,
  meta?: { sourceScope: ArrivalSmsSourceScope; sourceId: string },
): boolean {
  const digits = (phoneRaw || "").replace(/[^0-9]/g, "");
  if (!digits) return false;
  const phoneDisp = formatPhoneDisplay(digits);

  void (async () => {
    try {
      const res = await fetch("/api/send-arrival-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: digits,
          message: body,
          ...(meta
            ? { sourceScope: meta.sourceScope, sourceId: meta.sourceId }
            : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        code?: string;
        error?: string;
      } | null;
      if (res.ok && json?.ok) {
        showArrivalToast(`✅ 입고 안내 문자를 보냈습니다.\n${phoneDisp}`);
        try {
          onSent?.();
        } catch {
          /* ignore */
        }
        return;
      }
      // 키 미설정(503)·네트워크는 사유 없이 조용히 폴백, 그 외 실제 발송 실패는 사유 표시.
      const reason =
        json && json.code && json.code !== "not_configured"
          ? json.error || json.code
          : undefined;
      fallbackCopyAndOpen(digits, body, phoneDisp, reason);
    } catch {
      // 네트워크 오류 → 사유 없이 폴백
      fallbackCopyAndOpen(digits, body, phoneDisp);
    }
  })();

  return true;
}

/**
 * As-you-type display: 01012345678 -> 010-1234-5678; 8 digits -> 010-xxxx-xxxx.
 */
export function formatMobileInputDisplay(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^\?+$/.test(trimmed.replace(/\s/g, ""))) return "?";

  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 10) {
    digits = "0" + digits.slice(2);
  }
  if (digits.length === 8 && !digits.startsWith("0")) {
    digits = "010" + digits;
  }
  if (digits.startsWith("010")) {
    digits = digits.slice(0, 11);
    const rest = digits.slice(3);
    const p1 = rest.slice(0, 4);
    const p2 = rest.slice(4, 8);
    if (rest.length === 0) return "010";
    if (rest.length <= 4) return `010-${p1}`;
    return `010-${p1}-${p2}`;
  }
  return digits.slice(0, 11);
}

/**
 * Normalize Korean mobile for display/DB: 79994331 -> 010-7999-4331.
 * Preserves "?" and other non-digit placeholders from the ledger.
 */
export function normalizeKoreanMobilePhone(v: string): string {
  const raw = v.trim();
  if (!raw) return raw;
  const compact = raw.replace(/\s/g, "");
  if (/^\?+$/.test(compact)) return "?";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  let d = digits;
  if (d.startsWith("82") && d.length >= 10) {
    d = "0" + d.slice(2);
  }
  if (d.startsWith("010") && d.length === 11) {
    return "010-" + d.slice(3, 7) + "-" + d.slice(7);
  }
  if (d.length === 8) {
    return "010-" + d.slice(0, 4) + "-" + d.slice(4);
  }
  if (d.length === 10 && d.startsWith("10")) {
    return "010-" + d.slice(2, 6) + "-" + d.slice(6);
  }
  if (d.startsWith("010") && d.length > 3) {
    const rest = d.slice(3);
    if (rest.length >= 8) {
      return "010-" + rest.slice(0, 4) + "-" + rest.slice(4, 8);
    }
  }
  return raw;
}

/** 장부 표시용 — 010- 생략(문자·복사는 원본/normalize 사용) */
export function formatPhoneLedgerShort(v: string): string {
  const full = normalizeKoreanMobilePhone(v);
  if (!full) return "";
  if (full.startsWith("010-")) return full.slice(4);
  return full;
}

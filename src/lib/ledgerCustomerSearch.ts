/** 장부 표: 고객명·전화번호·제품명(선택)·추가 텍스트(선택) 부분 일치 검색 */
export function matchesLedgerCustomerSearch(
  query: string,
  name: string | null | undefined,
  phone: string | null | undefined,
  productName?: string | null | undefined,
  extraTerms?: Array<string | null | undefined>,
): boolean {
  const q = query.trim();
  if (!q) return true;
  const qLower = q.toLowerCase();
  const qDigits = q.replace(/\D+/g, "");
  const nameStr = (name ?? "").toString();
  if (nameStr && nameStr.toLowerCase().includes(qLower)) return true;
  const productStr = (productName ?? "").toString();
  if (productStr && productStr.toLowerCase().includes(qLower)) return true;
  for (const term of extraTerms ?? []) {
    const t = (term ?? "").toString();
    if (t && t.toLowerCase().includes(qLower)) return true;
  }
  if (qDigits.length > 0) {
    const phoneDigits = (phone ?? "").toString().replace(/\D+/g, "");
    if (phoneDigits.length > 0 && phoneDigits.includes(qDigits)) return true;
  }
  return false;
}

/** 매입내역·월매입 장부: 제품명 필드가 없을 때 품목·함량·특이사항 등으로 검색 */
export function purchaseLedgerSearchExtraTerms(p: {
  item_type?: string | null;
  purity?: string | null;
  karat?: string | null;
  note?: string | null;
}): Array<string | null | undefined> {
  return [p.item_type, p.purity, p.karat, p.note];
}

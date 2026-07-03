"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatDateTime,
  formatWonInputDisplay,
  localYmdFromIso,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
} from "@/lib/format";
import {
  GRAMS_PER_DON,
  KARAT_FACTORS,
  type FeeTier,
  type GoldPurchaseKaratValue,
  calculateGoldPurchase,
  is24KFamilyNoFee,
  isForeignGoldKarat,
  isGoldPurchaseKaratValue,
  parseForeignPureGoldGInput,
} from "@/lib/goldPurchase";
import {
  formatMobileInputDisplay,
  normalizeKoreanMobilePhone,
} from "@/lib/koreanPhone";
import {
  SILVER_PURITIES,
  type SilverPurity,
  defaultSilverPurity,
  calculateSilverPurchase,
  silverProcessingLedgerFieldsFromQuote,
} from "@/lib/silverPurchase";
import { buildChangeMap } from "@/lib/purchaseAudit";
import { formatAuditValue, labelForAuditField } from "@/lib/auditFormat";
import { processingLedgerFieldsForPurchase } from "@/lib/purchaseMargin";
import {
  JONGRO_QUOTE_SCOPE_GOLD,
  JONGRO_QUOTE_SCOPE_SILVER,
  type Purchase,
} from "@/types/db";

type KaratKey = GoldPurchaseKaratValue;
type GoldKaratSelection = KaratKey | "크라운" | "인레이";

const TRACKED_KEYS = [
  "seller_name",
  "seller_phone",
  "note",
  "payment_method",
  "purchased_at",
  "total_amount",
  "weight_g",
  "karat",
  "fee_tier",
  "gold_price_per_don",
  "processing_price_per_don",
  "margin_amount",
  "purity",
  "unit_price",
  "weight_don_raw",
  "purity_factor",
  "pure_gold_don",
];

type AuditRow = {
  id: string;
  changed_at: string;
  changes: Record<string, [string | null, string | null]>;
};

type Props = {
  supabase: SupabaseClient;
  purchase: Purchase | null;
  userId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function PurchaseEditDialog({
  supabase,
  purchase,
  userId,
  open,
  onClose,
  onSaved,
}: Props) {
  const [sellerName, setSellerName] = useState("");
  const [sellerPhone, setSellerPhone] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("현금");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [weightG, setWeightG] = useState("");
  const [foreignPureGoldG, setForeignPureGoldG] = useState("");
  const [karat, setKarat] = useState<GoldKaratSelection>("24K");
  const [feeTier, setFeeTier] = useState<FeeTier>("none");
  const [goldPricePerDon, setGoldPricePerDon] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [silverPurity, setSilverPurity] = useState<SilverPurity>(
    SILVER_PURITIES[0],
  );
  const [silverPricePerDon, setSilverPricePerDon] = useState("");

  useEffect(() => {
    setPaymentMethod((p) => (p === "카드" ? "기타" : p));
  }, []);

  useEffect(() => {
    if (!open || !purchase) return;
    setSellerName(purchase.seller_name ?? "");
    setSellerPhone(
      formatMobileInputDisplay(purchase.seller_phone ?? ""),
    );
    setNote(purchase.note ?? "");
    setPaymentMethod(purchase.payment_method ?? "현금");
    const d = new Date(purchase.purchased_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    setPurchasedAt(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
    setTotalAmount(sanitizeWonInputDigits(String(purchase.total_amount)));
    setWeightG(
      purchase.weight_g != null ? String(purchase.weight_g) : "",
    );
    const kRaw = String(purchase.karat ?? purchase.purity ?? "").trim();
    const isForeignRow =
      purchase.item_type === "금" &&
      (kRaw === "외국금" || kRaw.replace(/\s/g, "") === "외국금");
    setForeignPureGoldG(
      isForeignRow &&
        purchase.pure_gold_g != null &&
        Number.isFinite(Number(purchase.pure_gold_g)) &&
        Number(purchase.pure_gold_g) > 0
        ? String(purchase.pure_gold_g)
        : "",
    );
    if (purchase.item_type === "치금") {
      setKarat(kRaw === "인레이" ? "인레이" : "크라운");
      const ft = purchase.fee_tier as FeeTier;
      setFeeTier(ft === "a" || ft === "b" || ft === "c" ? ft : "a");
    } else {
      const k = kRaw as KaratKey;
      setKarat(isGoldPurchaseKaratValue(k) ? k : "24K");
      setFeeTier((purchase.fee_tier as FeeTier) || "none");
    }
    const goldPurchase =
      purchase.item_type === "금" || purchase.item_type === "치금";
    setGoldPricePerDon(
      goldPurchase
        ? sanitizeWonInputDigits(
            String(purchase.unit_price ?? purchase.gold_price_per_don ?? ""),
          )
        : "",
    );
    setSilverPurity(defaultSilverPurity(purchase.purity));
    setSilverPricePerDon(
      purchase.item_type === "은" &&
        (purchase.unit_price != null || purchase.gold_price_per_don != null)
        ? sanitizeWonInputDigits(
            String(purchase.unit_price ?? purchase.gold_price_per_don ?? ""),
          )
        : "",
    );
    setError(null);
  }, [open, purchase]);

  useEffect(() => {
    if (!open || !purchase) return;
    setLoadingLogs(true);
    void supabase
      .from("purchase_audit_log")
      .select("id, changed_at, changes")
      .eq("purchase_id", purchase.id)
      .order("changed_at", { ascending: false })
      .then(({ data, error: le }) => {
        setLoadingLogs(false);
        if (le) {
          setLogs([]);
          return;
        }
        setLogs((data ?? []) as AuditRow[]);
      });
  }, [open, purchase, supabase]);

  const isGold =
    purchase?.item_type === "금" || purchase?.item_type === "치금";
  const isChigum = purchase?.item_type === "치금";
  const isSilver = purchase?.item_type === "은";
  const isPlatinum = purchase?.item_type === "백금";

  useEffect(() => {
    if (!open || !purchase) return;
    if (!isGold) return;
    if (isChigum) {
      if (feeTier === "none") setFeeTier("c");
      return;
    }
    if (is24KFamilyNoFee(karat)) {
      setFeeTier("none");
    } else if (feeTier === "none") {
      setFeeTier("b");
    }
  }, [open, purchase, isGold, isChigum, karat, feeTier]);

  async function handleSave() {
    if (!purchase) return;
    setSaving(true);
    setError(null);

    const total = parseWonDigitsToNumber(totalAmount) ?? NaN;
    if (!Number.isFinite(total)) {
      setError("매입 금액은 숫자로 입력하세요.");
      setSaving(false);
      return;
    }

    const before: Record<string, unknown> = {
      seller_name: purchase.seller_name,
      seller_phone: purchase.seller_phone,
      note: purchase.note,
      payment_method: purchase.payment_method,
      purchased_at: purchase.purchased_at,
      total_amount: purchase.total_amount,
      weight_g: purchase.weight_g,
      karat: purchase.karat ?? purchase.purity,
      fee_tier: purchase.fee_tier,
      gold_price_per_don: purchase.gold_price_per_don,
      processing_price_per_don: purchase.processing_price_per_don,
      margin_amount: purchase.margin_amount,
      purity: purchase.purity,
      unit_price: purchase.unit_price,
      weight_don_raw: purchase.weight_don_raw,
      purity_factor: purchase.purity_factor,
      pure_gold_don: purchase.pure_gold_don,
    };

    const updatePayload: Record<string, unknown> = {
      seller_name: isChigum ? null : sellerName.trim() || null,
      seller_phone: isChigum
        ? null
        : sellerPhone.trim()
          ? normalizeKoreanMobilePhone(sellerPhone.trim())
          : null,
      note: note.trim() || null,
      payment_method: paymentMethod || null,
      purchased_at: new Date(purchasedAt).toISOString(),
      total_amount: total,
    };

    if (isGold) {
      const wVal = parseFloat(weightG.replace(",", "."));
      if (!Number.isFinite(wVal) || wVal <= 0) {
        setError("중량(g)을 입력하세요.");
        setSaving(false);
        return;
      }
      const pDon = parseWonDigitsToNumber(goldPricePerDon) ?? NaN;
      if (!Number.isFinite(pDon) || pDon < 0) {
        setError("오늘의 매입시세(원/돈)를 입력하세요.");
        setSaving(false);
        return;
      }
      const tier: FeeTier = isChigum
        ? feeTier === "a" || feeTier === "b" || feeTier === "c"
          ? feeTier
          : "a"
        : is24KFamilyNoFee(karat)
          ? "none"
          : feeTier;
      if (isChigum) {
        if (tier !== "a" && tier !== "b" && tier !== "c") {
          setError("치금은 매입비 a/b/c를 선택하세요.");
          setSaving(false);
          return;
        }
      } else if (!is24KFamilyNoFee(karat) && tier === "none") {
        setError("매입비 등급(a/b/c)을 선택하세요.");
        setSaving(false);
        return;
      }
      const pureGOverride = isForeignGoldKarat(karat)
        ? parseForeignPureGoldGInput(foreignPureGoldG)
        : null;
      if (isForeignGoldKarat(karat) && pureGOverride == null) {
        setError("외국금은 순금 중량(g)을 입력하세요.");
        setSaving(false);
        return;
      }
      const calc = calculateGoldPurchase({
        pricePerDon: pDon,
        weightG: wVal,
        karat,
        feeTier: tier,
        chigum: isChigum,
        pureGoldGOverride: pureGOverride,
      });
      if (!calc) {
        setError("금 계산에 실패했습니다.");
        setSaving(false);
        return;
      }

      const draftForLedger: Purchase = {
        ...purchase,
        weight_g: wVal,
        purity: karat,
        karat,
        total_amount: total,
        purity_factor: (KARAT_FACTORS as Record<string, number>)[karat],
        weight_don_raw: calc.weightDonRaw,
        pure_gold_g: calc.pureGoldG,
        pure_gold_don: calc.pureGoldDon,
        fee_tier: tier,
      };

      const purchasedAtIso = new Date(purchasedAt).toISOString();
      const quoteYmd = localYmdFromIso(purchasedAtIso);

      let goldPricePerDonStored = pDon;
      let processingWon: number | null = null;
      let marginAmt: number | null = null;

      const { data: savedQuote, error: quoteErr } = await supabase
        .from("jongro_daily_quotes")
        .select("price_per_don")
        .eq("branch_id", purchase.branch_id)
        .eq("quote_date", quoteYmd)
        .eq("quote_scope", JONGRO_QUOTE_SCOPE_GOLD)
        .maybeSingle();

      if (
        !quoteErr &&
        savedQuote != null &&
        savedQuote.price_per_don != null &&
        Number.isFinite(Number(savedQuote.price_per_don))
      ) {
        const procDon = Number(savedQuote.price_per_don);
        if (procDon >= 0) {
          const ledgerFields = processingLedgerFieldsForPurchase(
            procDon,
            draftForLedger,
          );
          if (ledgerFields != null) {
            goldPricePerDonStored = ledgerFields.gold_price_per_don;
            processingWon = ledgerFields.processing_price_per_don;
            marginAmt = ledgerFields.margin_amount;
          }
        }
      }

      Object.assign(updatePayload, {
        weight_g: wVal,
        purity: karat,
        karat,
        unit_price: pDon,
        gold_price_per_don: goldPricePerDonStored,
        purity_factor: (KARAT_FACTORS as Record<string, number>)[karat],
        weight_don_raw: calc.weightDonRaw,
        pure_gold_g: calc.pureGoldG,
        pure_gold_don: calc.pureGoldDon,
        fee_tier: tier,
        processing_price_per_don: processingWon,
        margin_amount: marginAmt,
      });
    } else if (purchase.item_type === "은") {
      const wVal = parseFloat(weightG.replace(",", "."));
      if (!Number.isFinite(wVal) || wVal <= 0) {
        setError("중량(g)을 입력하세요.");
        setSaving(false);
        return;
      }
      const pDon = parseWonDigitsToNumber(silverPricePerDon) ?? NaN;
      if (!Number.isFinite(pDon) || pDon < 0) {
        setError("오늘의 매입시세(은, 원/돈)를 입력하세요.");
        setSaving(false);
        return;
      }
      const sCalc = calculateSilverPurchase({
        pricePerDon: pDon,
        weightG: wVal,
        purity: silverPurity,
      });
      if (!sCalc) {
        setError("은 매입 계산에 실패했습니다.");
        setSaving(false);
        return;
      }

      const purchasedAtIso = new Date(purchasedAt).toISOString();
      const quoteYmd = localYmdFromIso(purchasedAtIso);

      let silverGoldPricePerDon: number | null = null;
      let silverProcessingWon: number | null = null;
      let silverMargin: number | null = null;

      const { data: silverSavedQuote, error: silverQuoteErr } = await supabase
        .from("jongro_daily_quotes")
        .select("price_per_don")
        .eq("branch_id", purchase.branch_id)
        .eq("quote_date", quoteYmd)
        .eq("quote_scope", JONGRO_QUOTE_SCOPE_SILVER)
        .maybeSingle();

      if (
        !silverQuoteErr &&
        silverSavedQuote != null &&
        silverSavedQuote.price_per_don != null &&
        Number.isFinite(Number(silverSavedQuote.price_per_don))
      ) {
        const sProc = Number(silverSavedQuote.price_per_don);
        if (sProc >= 0) {
          const sLedger = silverProcessingLedgerFieldsFromQuote(sProc, {
            item_type: purchase.item_type,
            weight_g: wVal,
            purity: silverPurity,
            total_amount: total,
          });
          if (sLedger != null) {
            silverGoldPricePerDon = sLedger.gold_price_per_don;
            silverProcessingWon = sLedger.processing_price_per_don;
            silverMargin = sLedger.margin_amount;
          }
        }
      }

      Object.assign(updatePayload, {
        weight_g: wVal,
        purity: silverPurity,
        unit_price: pDon,
        purity_factor: sCalc.mult,
        weight_don_raw: sCalc.rawDon,
        pure_gold_don: sCalc.billableDon,
        gold_price_per_don: silverGoldPricePerDon,
        processing_price_per_don: silverProcessingWon,
        margin_amount: silverMargin,
      });
    } else if (purchase.item_type === "백금") {
      const wVal = parseFloat(weightG.replace(",", "."));
      if (!Number.isFinite(wVal) || wVal <= 0) {
        setError("중량(g)을 입력하세요.");
        setSaving(false);
        return;
      }
      updatePayload.weight_g = wVal;
      updatePayload.weight_don_raw = wVal / GRAMS_PER_DON;
      updatePayload.purity = purchase.purity;
      updatePayload.unit_price = purchase.unit_price;
    } else {
      const wVal = weightG.trim()
        ? parseFloat(weightG.replace(",", "."))
        : null;
      const uVal = purchase.unit_price;
      updatePayload.weight_g = wVal;
      updatePayload.purity = purchase.purity;
      updatePayload.unit_price = uVal;
    }

    const after: Record<string, unknown> = { ...before, ...updatePayload };
    const changes = buildChangeMap(before, after, TRACKED_KEYS);

    const { error: ue } = await supabase
      .from("purchases")
      .update(updatePayload)
      .eq("id", purchase.id);

    if (ue) {
      setError(ue.message);
      setSaving(false);
      return;
    }

    if (Object.keys(changes).length > 0) {
      const { error: ae } = await supabase.from("purchase_audit_log").insert({
        purchase_id: purchase.id,
        changed_by: userId,
        changes,
      });
      if (ae) {
        window.alert(
          `매입 수정 내용은 저장되었습니다.\n\n변경 이력 테이블 기록만 실패했습니다.\n${ae.message}\n\nSupabase SQL Editor에서 migration_purchase_audit.sql 전체를 실행한 뒤, 필요하면 API 설정에서 스키마를 새로고침하세요.`,
        );
      }
    }

    setSaving(false);
    onSaved();
    onClose();
  }

  if (!open || !purchase) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">매입 수정 (관리자)</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          변경 내용은 아래 &quot;변경 이력&quot;에 누적됩니다.
        </p>

        {error ? (
          <p className="mt-3 toss-alert-error rounded-lg px-2 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <div className="mt-4 space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-[var(--muted)]">이름</label>
            <input
              value={isChigum ? "" : sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              disabled={isChigum}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2 disabled:cursor-not-allowed disabled:bg-stone-100"
              placeholder={isChigum ? "치금은 생략" : undefined}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--muted)]">전화번호</label>
            <input
              value={isChigum ? "" : sellerPhone}
              onChange={(e) =>
                setSellerPhone(formatMobileInputDisplay(e.target.value))
              }
              disabled={isChigum}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2 disabled:cursor-not-allowed disabled:bg-stone-100"
              placeholder={isChigum ? "치금은 생략" : "0000-0000"}
              inputMode="tel"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--muted)]">매입 일시</label>
            <input
              type="datetime-local"
              lang="en-GB"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
              className="mt-1 w-full max-w-[11rem] rounded-lg border border-[var(--border)] px-2 py-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--muted)]">매입 금액 (원)</label>
            <input
              value={formatWonInputDisplay(totalAmount)}
              onChange={(e) =>
                setTotalAmount(sanitizeWonInputDigits(e.target.value))
              }
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--muted)]">결제</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            >
              <option value="현금">현금</option>
              <option value="통장">통장</option>
              <option value="의제">의제</option>
              <option value="기타">기타</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--muted)]">특이사항</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            />
          </div>

          {isGold ? (
            <>
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">
                  중량(g)
                </label>
                <input
                  value={weightG}
                  onChange={(e) => setWeightG(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
                />
              </div>
              {isForeignGoldKarat(karat) ? (
                <div>
                  <label className="text-xs font-medium text-[var(--muted)]">
                    순금(g)
                  </label>
                  <input
                    value={foreignPureGoldG}
                    onChange={(e) => setForeignPureGoldG(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
                    inputMode="decimal"
                    placeholder="외국금 순금 중량"
                    title="함량마다 다르므로 순금 중량(g)을 직접 입력"
                  />
                </div>
              ) : null}
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">함량</label>
                <select
                  value={karat}
                  onChange={(e) => {
                    const next = e.target.value as GoldKaratSelection;
                    setKarat(next);
                    if (next !== "외국금") setForeignPureGoldG("");
                  }}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
                >
                  {purchase?.item_type === "금" ? (
                    <>
                      <optgroup label="순금">
                        <option value="24K">24K</option>
                        <option value="24K-1">24K-1</option>
                        <option value="외국금">외국금</option>
                      </optgroup>
                      <optgroup label="합금">
                        <option value="18K">18K</option>
                        <option value="14K">14K</option>
                        <option value="10K">10K</option>
                      </optgroup>
                    </>
                  ) : (
                    <>
                      <option value="크라운">크라운</option>
                      <option value="인레이">인레이</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">매입비</label>
                <select
                  value={
                    isChigum
                      ? feeTier
                      : is24KFamilyNoFee(karat)
                        ? "none"
                        : feeTier
                  }
                  onChange={(e) => setFeeTier(e.target.value as FeeTier)}
                  disabled={!isChigum && is24KFamilyNoFee(karat)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2 disabled:bg-stone-100"
                >
                  {isChigum ? (
                    <>
                      <option value="a">a</option>
                      <option value="b">b</option>
                      <option value="c">c</option>
                    </>
                  ) : is24KFamilyNoFee(karat) ? (
                    <option value="none">없음 (순금)</option>
                  ) : (
                    <>
                      <option value="a">a</option>
                      <option value="b">b</option>
                      <option value="c">c</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">
                  오늘의 매입시세 (원/돈)
                </label>
                <input
                  value={formatWonInputDisplay(goldPricePerDon)}
                  onChange={(e) =>
                    setGoldPricePerDon(sanitizeWonInputDigits(e.target.value))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
                />
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                매입 일시 날짜에 해당하는 종로 일별 처리시세가 있으면 저장 시 처리시세·처리원가·마진을
                그 기준으로 다시 맞춥니다. 없으면 매입등록과 같이 처리시세 칸은 매입시세 값으로 둡니다.
              </p>
            </>
          ) : null}

          {isPlatinum ? (
            <>
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">
                  중량(g)
                </label>
                <input
                  value={weightG}
                  onChange={(e) => setWeightG(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">돈수</label>
                <p className="mt-1 rounded-lg border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-2 py-2 tabular-nums text-[var(--foreground)]">
                  {(() => {
                    const w = parseFloat(weightG.replace(",", "."));
                    return Number.isFinite(w) && w > 0
                      ? (w / GRAMS_PER_DON).toFixed(2)
                      : "—";
                  })()}
                </p>
              </div>
            </>
          ) : null}

          {isSilver ? (
            <>
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">
                  오늘의 매입시세 (원/돈·은)
                </label>
                <input
                  value={formatWonInputDisplay(silverPricePerDon)}
                  onChange={(e) =>
                    setSilverPricePerDon(sanitizeWonInputDigits(e.target.value))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">
                  중량(g)
                </label>
                <input
                  value={weightG}
                  onChange={(e) => setWeightG(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">함량</label>
                <select
                  value={silverPurity}
                  onChange={(e) =>
                    setSilverPurity(e.target.value as SilverPurity)
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
                >
                  {SILVER_PURITIES.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--muted)]">돈수</label>
                <p className="mt-1 rounded-lg border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-2 py-2 tabular-nums text-[var(--foreground)]">
                  {(() => {
                    const w = parseFloat(weightG.replace(",", "."));
                    return Number.isFinite(w) && w > 0
                      ? (w / GRAMS_PER_DON).toFixed(2)
                      : "—";
                  })()}
                </p>
              </div>
            </>
          ) : null}
        </div>

        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <p className="text-sm font-medium text-[var(--foreground)]">변경 이력</p>
          {loadingLogs ? (
            <p className="mt-2 text-xs text-[var(--muted)]">불러오는 중…</p>
          ) : logs.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--muted)]">기록 없음</p>
          ) : (
            <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto text-xs">
              {logs.map((row) => (
                <li
                  key={row.id}
                  className="rounded border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-2 py-2"
                >
                  <span className="font-medium text-[var(--foreground)]">
                    {formatDateTime(row.changed_at)}
                  </span>
                  <ul className="mt-1 list-inside list-disc text-[var(--muted)]">
                    {Object.entries(row.changes).map(([k, pair]) => (
                      <li key={k}>
                        <span className="font-medium text-[var(--foreground)]">
                          {labelForAuditField(k)}
                        </span>
                        :{" "}
                        <span className="text-amount-out">
                          {formatAuditValue(k, pair[0])}
                        </span>{" "}
                        →{" "}
                        <span className="text-green-800">
                          {formatAuditValue(k, pair[1])}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="toss-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

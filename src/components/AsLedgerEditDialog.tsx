"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatWonInputDisplay,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
} from "@/lib/format";
import {
  formatMobileInputDisplay,
  normalizeKoreanMobilePhone,
} from "@/lib/koreanPhone";
import type { AsLedgerRow } from "@/types/db";

function isDoneMark(raw: string | null | undefined): boolean {
  const t = raw?.trim();
  return t === "완" || t === "완료";
}

function normalizeDoneMark(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t === "완") return "완료";
  return t;
}

function miniCompleteClass(done: boolean): string {
  return done
    ? "border-emerald-400 bg-emerald-50 text-emerald-900 focus:border-emerald-500 focus:ring-emerald-400/35"
    : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] focus:border-amber-500 focus:ring-amber-400/40";
}

type Props = {
  supabase: SupabaseClient;
  row: AsLedgerRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function AsLedgerEditDialog({
  supabase,
  row,
  open,
  onClose,
  onSaved,
}: Props) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [productName, setProductName] = useState("");
  const [repairNote, setRepairNote] = useState("");
  const [costDigits, setCostDigits] = useState("");
  const [paidNote, setPaidNote] = useState("");
  const [receivedNote, setReceivedNote] = useState("");
  const [shippedNote, setShippedNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !row) return;
    setCustomerName(row.customer_name ?? "");
    setCustomerPhone(formatMobileInputDisplay(row.customer_phone ?? ""));
    setProductName(row.product_name ?? "");
    setRepairNote(row.repair_note ?? "");
    setCostDigits(
      row.cost_won != null && Number.isFinite(Number(row.cost_won))
        ? sanitizeWonInputDigits(String(Math.round(Number(row.cost_won))))
        : "",
    );
    setPaidNote(isDoneMark(row.paid_note) ? "완" : (row.paid_note ?? ""));
    setReceivedNote(
      isDoneMark(row.received_note) ? "완" : (row.received_note ?? ""),
    );
    setShippedNote(
      isDoneMark(row.shipped_note) ? "완" : (row.shipped_note ?? ""),
    );
    setError(null);
  }, [open, row]);

  async function handleSave() {
    if (!row) return;
    const costN = parseWonDigitsToNumber(costDigits);
    const phoneTrim = customerPhone.trim();
    const noCharge =
      costN == null || costN === 0;
    const paidRaw = noCharge
      ? paidNote.trim() || "완"
      : paidNote.trim();

    setSaving(true);
    setError(null);
    const { error: ue } = await supabase
      .from("as_ledgers")
      .update({
        customer_name: customerName.trim() || null,
        customer_phone: phoneTrim
          ? normalizeKoreanMobilePhone(phoneTrim).trim() || null
          : null,
        product_name: productName.trim() || null,
        repair_note: repairNote.trim() || null,
        cost_won:
          costN != null && Number.isFinite(costN) && costN >= 0
            ? Math.round(costN)
            : null,
        paid_note: paidRaw ? normalizeDoneMark(paidRaw) ?? null : null,
        received_note: normalizeDoneMark(receivedNote) ?? null,
        shipped_note: normalizeDoneMark(shippedNote) ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    setSaving(false);
    if (ue) {
      setError(ue.message);
      return;
    }
    onSaved();
    onClose();
  }

  if (!open || !row) return null;

  const inputClass =
    "toss-input mt-1 h-9 w-full px-3 text-sm text-[var(--foreground)]";
  const inputNumClass = `${inputClass} text-right tabular-nums`;
  const miniInputClass = (done: boolean) =>
    `mt-1 h-9 w-full max-w-[4rem] rounded-md border px-2 text-center text-sm outline-none focus:ring-2 ${miniCompleteClass(done)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-[var(--foreground)]">
          AS 수정 (관리자)
        </h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          등록된 AS 기록의 고객·명세·비용·상태를 수정합니다.
        </p>

        {error ? (
          <p className="mt-3 toss-alert-error rounded-lg px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="toss-form-label block text-left">이름</label>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className={inputClass}
              placeholder="홍길동"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="toss-form-label block text-left">전화번호</label>
            <input
              value={customerPhone}
              onChange={(e) =>
                setCustomerPhone(formatMobileInputDisplay(e.target.value))
              }
              className={`${inputClass} tabular-nums`}
              placeholder="010-1234-5678"
              inputMode="tel"
            />
          </div>
          <div>
            <label className="toss-form-label block text-left">제품명</label>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className={inputClass}
              placeholder="반지/목걸이…"
            />
          </div>
          <div>
            <label className="toss-form-label block text-left">비용(원)</label>
            <input
              value={formatWonInputDisplay(costDigits)}
              onChange={(e) => {
                const digits = sanitizeWonInputDigits(e.target.value);
                setCostDigits(digits);
                const costN = parseWonDigitsToNumber(digits);
                if (costN == null || costN === 0) {
                  setPaidNote("완");
                } else if (isDoneMark(paidNote)) {
                  setPaidNote("");
                }
              }}
              inputMode="numeric"
              className={inputNumClass}
              placeholder="0"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="toss-form-label block text-left">수리내용</label>
            <input
              value={repairNote}
              onChange={(e) => setRepairNote(e.target.value)}
              className={inputClass}
              placeholder="줄수리/폴리싱…"
            />
          </div>
          <div>
            <label className="toss-form-label block text-left">결제</label>
            <input
              value={paidNote}
              onChange={(e) => setPaidNote(e.target.value)}
              maxLength={2}
              className={miniInputClass(isDoneMark(paidNote))}
              placeholder="완"
            />
          </div>
          <div>
            <label className="toss-form-label block text-left">입고</label>
            <input
              value={receivedNote}
              onChange={(e) => setReceivedNote(e.target.value)}
              maxLength={2}
              className={miniInputClass(isDoneMark(receivedNote))}
              placeholder="완"
            />
          </div>
          <div>
            <label className="toss-form-label block text-left">출고</label>
            <input
              value={shippedNote}
              onChange={(e) => setShippedNote(e.target.value)}
              maxLength={2}
              className={miniInputClass(isDoneMark(shippedNote))}
              placeholder="완"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="toss-btn-secondary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
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

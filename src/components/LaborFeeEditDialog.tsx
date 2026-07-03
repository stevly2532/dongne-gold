"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatWonInputDisplay,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
} from "@/lib/format";
import type { ProductLaborFee } from "@/types/db";

const MSG_MODEL_REQUIRED = "모델명을 입력하세요.";
const MSG_LABOR_REQUIRED = "공임(원)을 입력하세요.";
const MSG_WEIGHT_INVALID = "중량은 숫자로 입력하세요.";
const MSG_DUPLICATE = "이 매장·회사에 같은 제품명(모델명)이 이미 있습니다. 다른 이름으로 등록하거나 기존 항목을 수정하세요.";
const TITLE_EDIT = "공임 수정";
const TITLE_DESC = "거래처·모델명·공임·중량·비고를 수정할 수 있습니다.";
const LABEL_CLIENT = "거래처";
const PLACEHOLDER_CLIENT = "회사 이름";
const LABEL_MODEL = "모델명";
const LABEL_LABOR = "공임(원)";
const LABEL_WEIGHT = "중량(g)";
const LABEL_NOTE = "비고";
const PLACEHOLDER_MODEL = "제품명 / 모델번호";
const PLACEHOLDER_NOTE = "선택";
const BUTTON_CANCEL = "취소";
const BUTTON_SAVE = "저장";
const BUTTON_SAVING = "저장 중…";

type Props = {
  supabase: SupabaseClient;
  item: ProductLaborFee | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  userId: string | null;
};

export function LaborFeeEditDialog({
  supabase,
  item,
  open,
  onClose,
  onSaved,
  userId,
}: Props) {
  const [productCode, setProductCode] = useState("");
  const [clientName, setClientName] = useState("");
  const [laborDigits, setLaborDigits] = useState("");
  const [weightG, setWeightG] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) return;
    setProductCode(item.product_code ?? "");
    setClientName(item.client_name ?? "");
    setLaborDigits(
      item.labor_fee_won != null && Number.isFinite(Number(item.labor_fee_won))
        ? sanitizeWonInputDigits(String(Math.round(Number(item.labor_fee_won))))
        : "",
    );
    setWeightG(
      item.weight_g != null && Number.isFinite(Number(item.weight_g))
        ? String(Number(item.weight_g))
        : "",
    );
    setNote(item.note ?? "");
    setError(null);
  }, [open, item]);

  async function handleSave() {
    if (!item) return;
    const code = productCode.trim();
    if (!code) {
      setError(MSG_MODEL_REQUIRED);
      return;
    }
    const won = parseWonDigitsToNumber(laborDigits);
    if (won == null || won < 0) {
      setError(MSG_LABOR_REQUIRED);
      return;
    }
    const w = weightG.trim() ? parseFloat(weightG.replace(",", ".")) : null;
    if (w != null && !Number.isFinite(w)) {
      setError(MSG_WEIGHT_INVALID);
      return;
    }

    setSaving(true);
    setError(null);
    const { error: ue } = await supabase
      .from("product_labor_fees")
      .update({
        product_code: code,
        client_name: clientName.trim() || null,
        labor_fee_won: Math.round(won),
        weight_g: w,
        note: note.trim() || null,
        updated_at: new Date().toISOString(),
        updated_by: userId ?? null,
      })
      .eq("id", item.id);
    setSaving(false);
    if (ue) {
      const m = ue.message.toLowerCase();
      if (m.includes("unique") || m.includes("duplicate key")) {
        setError(MSG_DUPLICATE);
      } else {
        setError(ue.message);
      }
      return;
    }
    onSaved();
    onClose();
  }

  if (!open || !item) return null;

  const hideWeight = item.vendor === "순금";

  const inputClass =
    "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-400/30";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-[var(--foreground)]">{TITLE_EDIT}</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">{TITLE_DESC}</p>

        {error ? (
          <p className="mt-3 toss-alert-error rounded-lg px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-[var(--muted)]">{LABEL_CLIENT}</label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder={PLACEHOLDER_CLIENT}
              className={inputClass}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">{LABEL_MODEL}</label>
            <input
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              placeholder={PLACEHOLDER_MODEL}
              className={inputClass}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">{LABEL_LABOR}</label>
            <input
              inputMode="numeric"
              value={formatWonInputDisplay(laborDigits)}
              onChange={(e) => setLaborDigits(sanitizeWonInputDigits(e.target.value))}
              placeholder="0"
              className={`${inputClass} text-right tabular-nums`}
            />
          </div>

          {hideWeight ? null : (
            <div>
              <label className="text-xs font-medium text-[var(--muted)]">{LABEL_WEIGHT}</label>
              <input
                value={weightG}
                onChange={(e) => setWeightG(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                className={`${inputClass} text-right tabular-nums`}
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">{LABEL_NOTE}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={PLACEHOLDER_NOTE}
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-gray-50 dark:bg-gray-800/60 disabled:opacity-50"
          >
            {BUTTON_CANCEL}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="toss-btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving ? BUTTON_SAVING : BUTTON_SAVE}
          </button>
        </div>
      </div>
    </div>
  );
}

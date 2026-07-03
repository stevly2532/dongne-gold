"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatDateTime,
  formatKRW,
  formatWonInputDisplay,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
} from "@/lib/format";
import { buildChangeMap } from "@/lib/purchaseAudit";
import { formatAuditValue, labelForAuditField } from "@/lib/auditFormat";
import {
  formatMobileInputDisplay,
  normalizeKoreanMobilePhone,
} from "@/lib/koreanPhone";
import { computeSuggestedInventorySellWon } from "@/lib/inventorySuggestedSellWon";
import { isPurchaseVendorName } from "@/lib/productLaborFeeMatch";
import type { Branch, InventoryItem, Profile } from "@/types/db";

const SALES_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "gold", label: "24K" },
  { value: "gold_14k", label: "14K" },
  { value: "gold_18k", label: "18K" },
  { value: "silver", label: "은" },
  { value: "other", label: "기타" },
];

const PAYMENT_OPTIONS = ["현금", "통장", "카드", "현영", "기타"] as const;

const RECEIVABLE_OPTIONS = ["완불", "직접입력"] as const;

const FULFILLMENT_STATUS_OPTIONS = [
  { value: "즉시출고", label: "즉시출고(매장)" },
  { value: "발주", label: "주문" },
] as const;

const FULFILLMENT_DEFAULT = "즉시출고";

function normalizeFulfillmentStatus(raw: string | null | undefined): string {
  const allowed = new Set<string>(
    FULFILLMENT_STATUS_OPTIONS.map((o) => o.value),
  );
  const t = raw?.trim();
  if (t && allowed.has(t)) return t;
  return FULFILLMENT_DEFAULT;
}

function fulfillmentFlagsFromStatus(status: string): {
  received: boolean;
  shipped: boolean;
} {
  const shipped = status === "즉시출고";
  const received = status === "즉시출고";
  return { received, shipped };
}

/** 월매출장부 입고/출고 미니칸과 동일 기준 (발주 행 저장 시 수기·불리언 유지) */
function ledgerReceivedCompleteFromItem(row: InventoryItem): boolean {
  const t = row.received_note?.trim();
  if (t === "완" || t === "완료") return true;
  if (t) return false;
  return Boolean(row.received);
}

function ledgerShippedCompleteFromItem(row: InventoryItem): boolean {
  const t = row.shipped_note?.trim();
  if (t === "완" || t === "완료") return true;
  if (t) return false;
  return Boolean(row.shipped);
}

function normalizeSalesKindForForm(raw: string): string {
  const allowed = new Set(SALES_KIND_OPTIONS.map((o) => o.value));
  if (allowed.has(raw)) return raw;
  return "gold";
}

function inventoryAuditSnapshot(item: InventoryItem): Record<string, unknown> {
  return {
    branch_id: item.branch_id ?? null,
    sold_at: item.sold_at ?? null,
    name: item.name,
    kind: item.kind,
    quantity: item.quantity,
    unit: item.unit ?? "g",
    labor_fee: item.labor_fee ?? null,
    weight_g: item.weight_g ?? null,
    purity: item.purity ?? null,
    sell_price: item.sell_price ?? null,
    payment_method: item.payment_method ?? null,
    receivable_won: item.receivable_won ?? null,
    received: item.received ?? false,
    shipped: item.shipped ?? false,
    fulfillment_status: item.fulfillment_status ?? null,
    product_name: item.product_name ?? null,
    customer_name: item.customer_name ?? null,
    customer_phone: item.customer_phone ?? null,
    vendor_name: item.vendor_name ?? null,
    order_ref: item.order_ref ?? null,
    size: item.size ?? null,
    note: item.note ?? null,
  };
}

const INVENTORY_AUDIT_TRACKED_KEYS: string[] = [
  "branch_id",
  "sold_at",
  "name",
  "kind",
  "quantity",
  "unit",
  "labor_fee",
  "weight_g",
  "purity",
  "sell_price",
  "payment_method",
  "receivable_won",
  "received",
  "shipped",
  "fulfillment_status",
  "product_name",
  "customer_name",
  "customer_phone",
  "vendor_name",
  "order_ref",
  "size",
  "note",
];

const INVENTORY_AUDIT_SQL_HINT =
  "Supabase SQL Editor에서 저장소의 supabase/migration_inventory_audit_log.sql 전체를 실행한 뒤, 필요하면 Dashboard → Project Settings → API에서 스키마를 새로고침하세요.";

const ARRIVAL_SMS_LOG_SQL_HINT =
  "Supabase SQL Editor에서 supabase/migration_arrival_sms_log.sql 을 실행하세요.";

type AuditRow = {
  id: string;
  changed_at: string;
  changes: Record<string, [string | null, string | null]>;
};

type SmsLogRow = {
  id: string;
  sent_at: string;
  phone_digits: string;
  message_body: string;
};

function isMissingArrivalSmsLogTable(err: { code?: string; message?: string }) {
  const m = (err.message ?? "").toLowerCase();
  return (
    err.code === "42P01" ||
    err.code === "PGRST204" ||
    m.includes("arrival_sms_log") ||
    m.includes("schema cache") ||
    m.includes("does not exist")
  );
}

type Props = {
  supabase: SupabaseClient;
  item: InventoryItem | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  userId: string;
  branches: Branch[];
  profile: Profile | null;
  branchRows: { id: string; label: string }[];
  quoteGoldPerDonDigits: string;
  quoteSilverPerDonDigits: string;
  /** true면 공임 입력란을 숨기고 저장 시 DB의 공임을 그대로 둡니다 (판매등록 매출내역 등). */
  hideLaborFee?: boolean;
};

export function InventoryEditDialog({
  supabase,
  item,
  open,
  onClose,
  onSaved,
  userId,
  branches: _branches,
  profile,
  branchRows,
  quoteGoldPerDonDigits,
  quoteSilverPerDonDigits,
  hideLaborFee = false,
}: Props) {
  const [branchId, setBranchId] = useState("");
  const [soldAtLocal, setSoldAtLocal] = useState("");
  const [name, setName] = useState("");
  const [productName, setProductName] = useState("");
  const [kind, setKind] = useState("gold");
  const [quantity, setQuantity] = useState("");
  const [laborFee, setLaborFee] = useState("");
  const [weightG, setWeightG] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("현금");
  const [receivableMode, setReceivableMode] = useState<
    (typeof RECEIVABLE_OPTIONS)[number]
  >("완불");
  const [receivableWonDigits, setReceivableWonDigits] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [size, setSize] = useState("");
  const [note, setNote] = useState("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState(
    FULFILLMENT_DEFAULT,
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [smsLogs, setSmsLogs] = useState<SmsLogRow[]>([]);
  const [loadingSmsLogs, setLoadingSmsLogs] = useState(false);
  const [smsLogUnavailable, setSmsLogUnavailable] = useState(false);

  const isAdmin = profile?.role === "admin";
  const staffBranchId = profile?.branch_id ?? null;
  const branchLabelMap = useMemo(
    () => new Map(branchRows.map((r) => [r.id, r.label])),
    [branchRows],
  );

  useEffect(() => {
    if (!open || !item) return;

    setBranchId(item.branch_id ?? staffBranchId ?? "");
    const d = new Date(item.sold_at ?? item.updated_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    setSoldAtLocal(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
    setName(item.name ?? "");
    setProductName(item.product_name ?? "");
    setKind(normalizeSalesKindForForm(item.kind));
    setQuantity(String(item.quantity ?? ""));
    setLaborFee(
      item.labor_fee != null && Number.isFinite(Number(item.labor_fee))
        ? String(item.labor_fee)
        : "",
    );
    setWeightG(
      item.weight_g != null && Number.isFinite(Number(item.weight_g))
        ? String(item.weight_g)
        : "",
    );
    setSellPrice(
      item.sell_price != null && Number.isFinite(Number(item.sell_price))
        ? sanitizeWonInputDigits(String(item.sell_price))
        : "",
    );
    setPaymentMethod(item.payment_method ?? "현금");
    const rw = item.receivable_won != null ? Number(item.receivable_won) : 0;
    if (Number.isFinite(rw) && rw > 0) {
      setReceivableMode("직접입력");
      setReceivableWonDigits(sanitizeWonInputDigits(String(Math.round(rw))));
    } else {
      setReceivableMode("완불");
      setReceivableWonDigits("");
    }
    setCustomerName(item.customer_name ?? "");
    setCustomerPhone(
      formatMobileInputDisplay(item.customer_phone ?? ""),
    );
    setVendorName(item.vendor_name ?? "");
    setSize(item.size ?? "");
    setNote(item.note ?? "");
    setFulfillmentStatus(normalizeFulfillmentStatus(item.fulfillment_status));
    setError(null);
  }, [open, item, staffBranchId]);

  useEffect(() => {
    if (!open || !item) return;
    setLoadingLogs(true);
    void supabase
      .from("inventory_audit_log")
      .select("id, changed_at, changes")
      .eq("inventory_item_id", item.id)
      .order("changed_at", { ascending: false })
      .then(({ data, error: le }) => {
        setLoadingLogs(false);
        if (le) {
          setLogs([]);
          return;
        }
        setLogs((data ?? []) as AuditRow[]);
      });
  }, [open, item, supabase]);

  useEffect(() => {
    if (!open || !item) return;
    setLoadingSmsLogs(true);
    setSmsLogUnavailable(false);
    void supabase
      .from("arrival_sms_log")
      .select("id, sent_at, phone_digits, message_body")
      .eq("source_scope", "inventory")
      .eq("source_id", item.id)
      .order("sent_at", { ascending: false })
      .then(({ data, error: le }) => {
        setLoadingSmsLogs(false);
        if (le) {
          if (isMissingArrivalSmsLogTable(le)) {
            setSmsLogUnavailable(true);
          }
          setSmsLogs([]);
          return;
        }
        setSmsLogs((data ?? []) as SmsLogRow[]);
      });
  }, [open, item, supabase]);

  const suggestedSellWon = useMemo(
    () =>
      computeSuggestedInventorySellWon({
        kind,
        weightG,
        laborFee,
        goldPricePerDon: parseWonDigitsToNumber(quoteGoldPerDonDigits),
        silverPricePerDon: parseWonDigitsToNumber(quoteSilverPerDonDigits),
      }),
    [kind, weightG, laborFee, quoteGoldPerDonDigits, quoteSilverPerDonDigits],
  );

  async function handleSave() {
    if (!item) return;

    if (!name.trim()) {
      setError("제품코드를 입력하세요.");
      return;
    }
    const qty = parseFloat(quantity.replace(",", "."));
    if (!Number.isFinite(qty)) {
      setError("수량은 숫자로 입력하세요.");
      return;
    }

    let purityOut: string | null = null;
    if (kind === "gold_18k") purityOut = "18K";
    else if (kind === "gold_14k") purityOut = "14K";

    const labor = hideLaborFee
      ? item.labor_fee != null && Number.isFinite(Number(item.labor_fee))
        ? Number(item.labor_fee)
        : null
      : isPurchaseVendorName(vendorName)
        ? null
        : laborFee.trim()
          ? parseFloat(laborFee.replace(/,/g, ""))
          : null;
    const w = weightG.trim() ? parseFloat(weightG.replace(",", ".")) : null;
    const sell = sellPrice.trim()
      ? parseFloat(sellPrice.replace(/,/g, ""))
      : null;
    if (!hideLaborFee && labor != null && !Number.isFinite(labor)) {
      setError("공임은 숫자로 입력하세요.");
      return;
    }
    if (w != null && !Number.isFinite(w)) {
      setError("중량은 숫자로 입력하세요.");
      return;
    }
    if (sell != null && !Number.isFinite(sell)) {
      setError("판매가는 숫자로 입력하세요.");
      return;
    }

    const branchForSave =
      isAdmin && branchId.trim()
        ? branchId.trim()
        : staffBranchId ?? item.branch_id ?? null;
    if (!branchForSave) {
      setError("매장을 선택하세요.");
      return;
    }

    const fs = normalizeFulfillmentStatus(fulfillmentStatus);
    const baseFlags = fulfillmentFlagsFromStatus(fs);
    const received =
      fs === "발주"
        ? ledgerReceivedCompleteFromItem(item)
        : baseFlags.received;
    const shipped =
      fs === "발주"
        ? ledgerShippedCompleteFromItem(item)
        : baseFlags.shipped;

    const receivable =
      receivableMode === "직접입력"
        ? parseFloat(receivableWonDigits.replace(/,/g, ""))
        : 0;
    const receivableOut =
      receivableMode === "직접입력" &&
      Number.isFinite(receivable) &&
      receivable > 0
        ? Math.round(receivable)
        : null;

    const soldIso = new Date(soldAtLocal).toISOString();
    if (!Number.isFinite(new Date(soldAtLocal).getTime())) {
      setError("판매 일시가 올바르지 않습니다.");
      return;
    }

    const before = inventoryAuditSnapshot(item);

    const updatePayload = {
      branch_id: branchForSave,
      sold_at: soldIso,
      name: name.trim(),
      kind,
      quantity: qty,
      unit: "g",
      labor_fee: labor,
      weight_g: w,
      purity: purityOut,
      sell_price: sell,
      payment_method: paymentMethod,
      receivable_won: receivableOut,
      received,
      shipped,
      fulfillment_status: fs,
      product_name: productName.trim() || null,
      customer_name: customerName.trim() || null,
      customer_phone:
        normalizeKoreanMobilePhone(customerPhone.trim()) || null,
      vendor_name: vendorName.trim() || null,
      order_ref: item.order_ref ?? null,
      size: size.trim() || null,
      note: note.trim() || null,
      updated_at: new Date().toISOString(),
    };

    setSaving(true);
    setError(null);

    const { error: ue } = await supabase
      .from("inventory_items")
      .update(updatePayload)
      .eq("id", item.id);

    if (ue) {
      setError(ue.message);
      setSaving(false);
      return;
    }

    const { updated_at: _skip, ...auditFields } = updatePayload;
    const after: Record<string, unknown> = { ...before, ...auditFields };
    const changes = buildChangeMap(before, after, INVENTORY_AUDIT_TRACKED_KEYS);

    if (Object.keys(changes).length > 0 && userId) {
      const { error: ae } = await supabase.from("inventory_audit_log").insert({
        inventory_item_id: item.id,
        changed_by: userId,
        changes,
      });
      if (ae) {
        window.alert(
          `매출 수정 내용은 저장되었습니다.\n\n변경 이력 테이블 기록만 실패했습니다.\n${ae.message}\n\n${INVENTORY_AUDIT_SQL_HINT}`,
        );
      }
    }

    setSaving(false);
    onSaved();
    onClose();
  }

  async function handleDelete() {
    if (!item) return;
    if (!confirm("이 매출 기록을 삭제할까요?")) return;
    setDeleting(true);
    setError(null);
    const { error: de } = await supabase
      .from("inventory_items")
      .delete()
      .eq("id", item.id);
    setDeleting(false);
    if (de) {
      setError(de.message);
      return;
    }
    onSaved();
    onClose();
  }

  if (!open || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">
          매출 수정 (관리자)
        </h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          매출내역에서 연 필드만 수정합니다. 주문·입고·출고 수기는 표에서
          그대로 편집할 수 있습니다. 변경 내용은 아래 &quot;변경 이력&quot;에
          누적됩니다(관리자만 조회).
        </p>

        {error ? (
          <p className="mt-3 toss-alert-error rounded-lg px-2 py-2 text-sm">
            {error}
          </p>
        ) : null}

        <div className="mt-4 space-y-3 text-sm">
          {isAdmin ? (
            <div>
              <label className="text-xs font-medium text-[var(--muted)]">
                매장
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
              >
                <option value="">선택</option>
                {branchRows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              소속 매장 기준으로만 저장됩니다.
            </p>
          )}

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">
              판매 일시
            </label>
            <input
              type="datetime-local"
              lang="en-GB"
              value={soldAtLocal}
              onChange={(e) => setSoldAtLocal(e.target.value)}
              className="mt-1 w-full max-w-[11rem] rounded-lg border border-[var(--border)] px-2 py-2 text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">품목</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            >
              {SALES_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">
              제품코드
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">
              직접 입력 제품명
            </label>
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
              placeholder="없으면 비움"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">수량</label>
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2 tabular-nums"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">
              중량(g)
            </label>
            <input
              value={weightG}
              onChange={(e) => setWeightG(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2 tabular-nums"
            />
          </div>

          {hideLaborFee ? null : (
            <div>
              <label className="text-xs font-medium text-[var(--muted)]">공임</label>
              <input
                value={laborFee}
                onChange={(e) => setLaborFee(e.target.value)}
                placeholder={isPurchaseVendorName(vendorName) ? "매입" : undefined}
                className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2 tabular-nums"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">
              판매가 (원)
            </label>
            <input
              value={formatWonInputDisplay(sellPrice)}
              onChange={(e) =>
                setSellPrice(sanitizeWonInputDigits(e.target.value))
              }
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            />
            {suggestedSellWon != null ? (
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                화면 시세 기준 추천 판매가:{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {formatKRW(suggestedSellWon)}
                </span>
              </p>
            ) : null}
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">결제</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            >
              {PAYMENT_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">미수</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select
                value={receivableMode}
                onChange={(e) =>
                  setReceivableMode(e.target.value as (typeof RECEIVABLE_OPTIONS)[number])
                }
                className="rounded-lg border border-[var(--border)] px-2 py-2"
              >
                {RECEIVABLE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {receivableMode === "직접입력" ? (
                <input
                  value={formatWonInputDisplay(receivableWonDigits)}
                  onChange={(e) =>
                    setReceivableWonDigits(sanitizeWonInputDigits(e.target.value))
                  }
                  className="min-w-[8rem] flex-1 rounded-lg border border-[var(--border)] px-2 py-2"
                  placeholder="원"
                />
              ) : null}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">
              고객 이름
            </label>
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">
              고객 전화
            </label>
            <input
              value={customerPhone}
              onChange={(e) =>
                setCustomerPhone(formatMobileInputDisplay(e.target.value))
              }
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
              inputMode="tel"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">
              거래처(매입처 등)
            </label>
            <input
              value={vendorName}
              onChange={(e) => {
                const v = e.target.value;
                setVendorName(v);
                if (isPurchaseVendorName(v)) setLaborFee("");
              }}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">사이즈</label>
            <input
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">발주</label>
            <select
              value={fulfillmentStatus}
              onChange={(e) => setFulfillmentStatus(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            >
              {FULFILLMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">비고</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] px-2 py-2"
            />
          </div>
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
                          {formatAuditValue(k, pair[0], branchLabelMap)}
                        </span>{" "}
                        →{" "}
                        <span className="text-green-800">
                          {formatAuditValue(k, pair[1], branchLabelMap)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="text-sm font-medium text-[var(--foreground)]">
            입고 안내 문자 발송 기록
          </p>
          {loadingSmsLogs ? (
            <p className="mt-2 text-xs text-[var(--muted)]">불러오는 중…</p>
          ) : smsLogUnavailable ? (
            <p className="mt-2 text-xs text-amber-800">
              발송 기록 테이블이 없습니다. {ARRIVAL_SMS_LOG_SQL_HINT}
            </p>
          ) : smsLogs.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--muted)]">발송 기록 없음</p>
          ) : (
            <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto text-xs">
              {smsLogs.map((row) => (
                <li
                  key={row.id}
                  className="rounded border border-[var(--border)] bg-gray-50 dark:bg-gray-800/60 px-2 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium text-[var(--foreground)]">
                      {formatDateTime(row.sent_at)}
                    </span>
                    <span className="text-[var(--muted)]">
                      →{" "}
                      {formatMobileInputDisplay(row.phone_digits) ||
                        row.phone_digits}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">
                    {row.message_body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={saving || deleting}
            onClick={() => void handleDelete()}
            className="toss-btn-secondary mr-auto rounded-lg px-4 py-2 text-sm text-amount-out disabled:opacity-50"
          >
            {deleting ? "삭제 중…" : "삭제"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving || deleting}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={saving || deleting}
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

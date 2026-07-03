import { ledgerDisplayDonFromWeightG } from "@/lib/goldPurchase";
import type { TongsangDailyEntry } from "@/types/db";

export const TONGSANG_SHIPMENT_SLOT_COUNT = 5;
export const TONGSANG_SHIPMENT_PAIR_SEP = "|";

export type TongsangKaratRow = "24K" | "18K" | "14K";

export type TongsangKaratDonLine = {
  karat: TongsangKaratRow;
  don: number;
};

function tongsangDbGramToInput(g: number | null | undefined): string {
  if (g == null || !Number.isFinite(Number(g))) return "";
  return String(g);
}

/** 일마감(통상) 장부 순금돈수 전용 함량계수 — 매입·장부 등 다른 화면과 분리 */
export const TONGSANG_PURE_DON_FACTORS: Record<TongsangKaratRow, number> = {
  "24K": 1,
  "18K": 0.74,
  "14K": 0.575,
};

export type TongsangShipmentSlot = { name: string; detail: string };

export function parseTongsangGramInput(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function tongsangDonFromGramInput(raw: string): number | null {
  const g = parseTongsangGramInput(raw);
  if (g == null) return null;
  const don = ledgerDisplayDonFromWeightG(g);
  return Number.isFinite(don) ? don : null;
}

export function tongsangPureDonFromGramInput(
  raw: string,
  karat: TongsangKaratRow,
): number | null {
  const don = tongsangDonFromGramInput(raw);
  if (don == null) return null;
  const factor = TONGSANG_PURE_DON_FACTORS[karat];
  const pure = Number((don * factor).toFixed(2));
  return Number.isFinite(pure) ? pure : null;
}

export function tongsangPureDonTotal(
  pureG: string,
  k18G: string,
  k14G: string,
): number | null {
  const parts = [
    tongsangPureDonFromGramInput(pureG, "24K"),
    tongsangPureDonFromGramInput(k18G, "18K"),
    tongsangPureDonFromGramInput(k14G, "14K"),
  ].filter((v): v is number => v != null);
  if (parts.length === 0) return null;
  return Number(parts.reduce((a, b) => a + b, 0).toFixed(2));
}

export function encodeTongsangShipmentSlot(
  name: string,
  detail: string,
): string | null {
  const n = name.trim();
  const d = detail.trim();
  if (!n && !d) return null;
  if (!d) return n;
  return `${n}${TONGSANG_SHIPMENT_PAIR_SEP}${d}`;
}

export function decodeTongsangShipmentSlot(
  raw: string | null | undefined,
): TongsangShipmentSlot {
  const t = (raw ?? "").trim();
  if (!t) return { name: "", detail: "" };
  const i = t.indexOf(TONGSANG_SHIPMENT_PAIR_SEP);
  if (i === -1) return { name: t, detail: "" };
  return {
    name: t.slice(0, i).trim(),
    detail: t.slice(i + 1).trim(),
  };
}

export function formatTongsangShipmentSlotLabel(
  slot: TongsangShipmentSlot,
): string {
  if (!slot.name && !slot.detail) return "";
  if (!slot.detail) return slot.name;
  if (!slot.name) return slot.detail;
  return `${slot.name} · ${slot.detail}`;
}

export function formatTongsangDon(don: number | null | undefined): string {
  if (don == null || !Number.isFinite(Number(don))) return "—";
  return `${Number(don).toFixed(2)}돈`;
}

export function formatTongsangGram(g: number | null | undefined): string {
  if (g == null || !Number.isFinite(Number(g))) return "—";
  const r = Math.round(Number(g) * 10000) / 10000;
  return `${r.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}g`;
}

export function tongsangShipmentSlots(row: TongsangDailyEntry): TongsangShipmentSlot[] {
  return [
    row.shipment_item_1,
    row.shipment_item_2,
    row.shipment_item_3,
    row.shipment_item_4,
    row.shipment_item_5,
  ].map((s) => decodeTongsangShipmentSlot(s));
}

export function tongsangShipmentSummary(row: TongsangDailyEntry): string {
  const items = tongsangShipmentSlots(row)
    .map(formatTongsangShipmentSlotLabel)
    .filter(Boolean);
  if (items.length === 0) return "—";
  if (items.length === 1) return items[0];
  return `${items[0]} 외 ${items.length - 1}건`;
}

export function parseTongsangCapturedDonInput(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Number(n.toFixed(2));
}

export function tongsangCapturedDonForKarat(
  row: TongsangDailyEntry,
  karat: TongsangKaratRow,
): number | null {
  if (karat === "24K") {
    const v = row.captured_don_24k ?? row.captured_pure_don;
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  }
  if (karat === "18K") {
    const v = row.captured_don_18k;
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  }
  const v = row.captured_don_14k;
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

export function tongsangCapturedDonTotal(
  ...values: Array<number | null | undefined>
): number | null {
  const parts = values.filter(
    (v): v is number => v != null && Number.isFinite(Number(v)),
  );
  if (parts.length === 0) return null;
  return Number(parts.reduce((a, b) => a + Number(b), 0).toFixed(2));
}

export function tongsangCapturedDonSummary(row: TongsangDailyEntry): string {
  const parts = tongsangCapturedDonLinesFromEntry(row).map(
    ({ karat, don }) => `${karat} ${Number(don).toFixed(2)}`,
  );
  if (parts.length === 0) return "—";
  return parts.join(" · ");
}

/** 일별 기록 — 함량별 순금돈수(중량 기준) */
export function tongsangPureDonLinesFromEntry(
  row: TongsangDailyEntry,
): TongsangKaratDonLine[] {
  const specs: Array<{ karat: TongsangKaratRow; g: number | null | undefined }> =
    [
      { karat: "24K", g: row.pure_gold_g },
      { karat: "18K", g: row.gold_18k_g },
      { karat: "14K", g: row.gold_14k_g },
    ];
  const lines: TongsangKaratDonLine[] = [];
  for (const { karat, g } of specs) {
    const don = tongsangPureDonFromGramInput(tongsangDbGramToInput(g), karat);
    if (don != null) lines.push({ karat, don });
  }
  return lines;
}

/** 일별 기록 — 함량별 잡힌돈수 */
export function tongsangCapturedDonLinesFromEntry(
  row: TongsangDailyEntry,
): TongsangKaratDonLine[] {
  const lines: TongsangKaratDonLine[] = [];
  for (const karat of ["24K", "18K", "14K"] as const) {
    const v = tongsangCapturedDonForKarat(row, karat);
    if (v != null) lines.push({ karat, don: Number(v) });
  }
  return lines;
}

export function formatTongsangEntryDateDisplay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const yy = m[1].slice(-2);
  return `${yy}.${m[2]}.${m[3]}`;
}

export function isMissingTongsangTable(err: {
  code?: string;
  message?: string;
}): boolean {
  const m = (err.message ?? "").toLowerCase();
  return (
    err.code === "42P01" ||
    err.code === "PGRST204" ||
    m.includes("tongsang_daily_entries") ||
    m.includes("schema cache") ||
    m.includes("does not exist")
  );
}

export const TONGSANG_SETUP_HINT =
  "Supabase SQL Editor에서 supabase/migration_tongsang_daily_entries.sql 을 실행하세요.";

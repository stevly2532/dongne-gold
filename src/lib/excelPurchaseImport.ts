import * as XLSX from "xlsx";
import {
  GRAMS_PER_DON,
  KARAT_FACTORS,
  type FeeTier,
  calculateGoldPurchase,
  FOREIGN_GOLD_WEIGHT_MULT,
  impliedGoldPricePerDonFromTotal,
  is24KFamilyNoFee,
  isForeignGoldKarat,
  roundWon,
} from "@/lib/goldPurchase";
import { normalizeKoreanMobilePhone } from "@/lib/koreanPhone";

export type ExcelImportRow = Record<string, unknown>;

function normHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .toLowerCase();
}

type ColKey =
  | "purchased_at"
  | "seller_name"
  | "seller_phone"
  | "item_type"
  | "weight_g"
  | "karat"
  | "fee_tier"
  | "gold_price_per_don"
  | "total_amount"
  | "payment_method"
  | "note"
  | "processing_price_per_don"
  | "pure_gold_don_direct";

const ASCI_KEYS: Record<string, ColKey> = {
  datetime: "purchased_at",
  purchased_at: "purchased_at",
  date: "purchased_at",
  seller_name: "seller_name",
  seller_phone: "seller_phone",
  hp: "seller_phone",
  item_type: "item_type",
  weight: "weight_g",
  weight_g: "weight_g",
  k: "karat",
  karat: "karat",
  fee_tier: "fee_tier",
  gold_price_per_don: "gold_price_per_don",
  total_amount: "total_amount",
  payment_method: "payment_method",
  payment: "payment_method",
  note: "note",
  processing: "processing_price_per_don",
  processing_price_per_don: "processing_price_per_don",
};

const KO_PAIRS: [string, ColKey][] = [
  ["\uC77C\uC2DC", "purchased_at"],
  ["\uB0A0\uC9DC", "purchased_at"],
  ["\uB9E4\uC785\uC77C\uC2DC", "purchased_at"],
  ["\uC2DC\uAC04", "purchased_at"],
  ["\uC774\uB984", "seller_name"],
  ["\uD310\uB9E4\uC790", "seller_name"],
  ["\uD310\uB9E4\uC790\uC774\uB984", "seller_name"],
  ["\uC131\uBA85", "seller_name"],
  ["\uC804\uD654", "seller_phone"],
  ["\uC804\uD654\uBC88\uD638", "seller_phone"],
  ["\uC5F0\uB77D\uCC98", "seller_phone"],
  ["\uACE0\uAC1D\uBA85", "seller_name"],
  ["\uBC88\uD638", "seller_phone"],
  ["\uB0B4\uC900\uAE08\uC561", "total_amount"],
  ["\uC885\uB85C\uC2DC\uC138", "processing_price_per_don"],
  ["\uC21C\uAE08", "pure_gold_don_direct"],
  ["\uD488\uBAA9", "item_type"],
  ["\uC885\uB958", "item_type"],
  ["\uC911\uB7C9", "weight_g"],
  ["\uC911\uB7C9g", "weight_g"],
  ["\uD568\uB7C9", "karat"],
  ["\uC21C\uB3C4", "karat"],
  ["\uB9E4\uC785\uBE44", "fee_tier"],
  ["\uB4F1\uAE09", "fee_tier"],
  ["\uC2DC\uC138", "gold_price_per_don"],
  ["\uB9E4\uC785\uC2DC\uC138", "gold_price_per_don"],
  ["\uAE08\uC2DC\uC138", "gold_price_per_don"],
  ["\uC6D0\uB3C8", "gold_price_per_don"],
  ["\uC624\uB298\uC758\uB9E4\uC785\uC2DC\uC138", "gold_price_per_don"],
  ["\uC7A5\uBD80\uC2DC\uC138", "gold_price_per_don"],
  ["\uB9E4\uC785\uAE08\uC561", "total_amount"],
  ["\uAE08\uC561", "total_amount"],
  ["\uD569\uACC4", "total_amount"],
  ["\uB9E4\uC785\uC561", "total_amount"],
  ["\uACB0\uC81C", "payment_method"],
  ["\uBE44\uACE0", "note"],
  ["\uBA54\uBAA8", "note"],
  ["\uCC98\uB9AC\uC2DC\uC138", "processing_price_per_don"],
  ["\uCC98\uB9AC", "processing_price_per_don"],
];

function mapHeaderToKey(cell: unknown): ColKey | null {
  const n = normHeader(cell);
  const a = ASCI_KEYS[n];
  if (a) return a;
  for (const [ko, key] of KO_PAIRS) {
    if (normHeader(ko) === n) return key;
  }
  if (n.includes("\uCC98\uB9AC") && !n.includes("\uC885\uB85C")) {
    return "processing_price_per_don";
  }
  if (n.includes("\uC885\uB85C") && n.includes("\uC2DC\uC138")) {
    return "processing_price_per_don";
  }
  if (
    n.includes("\uB0B4\uC900") &&
    n.includes("\uAE08\uC561") &&
    !n.includes("\uC2DC\uC138")
  ) {
    return "total_amount";
  }
  if (
    n.includes("\uB9E4\uC785\uAE08") ||
    (n.includes("\uAE08\uC561") && !n.includes("\uC2DC\uC138"))
  ) {
    return "total_amount";
  }
  if (n.includes("\uACE0\uAC1D") && n.includes("\uBA85")) return "seller_name";
  if (n === "\uBC88\uD638" || n.endsWith("\uBC88\uD638")) return "seller_phone";
  if (n.includes("\uC21C\uAE08") && !n.includes("\uC911")) {
    return "pure_gold_don_direct";
  }
  return null;
}

/** Fullwidth ０-９ → ASCII 0-9 */
function normalizeFullWidthDigits(s: string): string {
  return s.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );
}

/** \uB144\uC6D4\uC77C: 2025\uB144 3\uC6D4 1\uC77C, 3\uC6D4 1\uC77C, 3\uC6D41\uC77C (\uC5F0\uB3C4 \uC0DD\uB7B5\uC2DC defaultYear) */
function parseKoreanDateString(s: string, defaultYear: number): Date | null {
  let t = s
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, " ");
  t = normalizeFullWidthDigits(t);
  const paren = t.indexOf("(");
  if (paren > 0) t = t.slice(0, paren).trim();

  let m = t.match(
    /^(\d{4})\s*\uB144\s*(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C/,
  );
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = t.match(/^(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C/);
  if (m) {
    const d = new Date(defaultYear, Number(m[1]) - 1, Number(m[2]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = t.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = t.match(/^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    let year = defaultYear;
    if (m[3]) {
      const y = Number(m[3]);
      year = y < 100 ? 2000 + y : y;
    }
    const d = new Date(year, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function cellToIso(v: unknown, defaultYear?: number): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const p = XLSX.SSF.parse_date_code(v);
    if (p) {
      const d = new Date(
        p.y,
        p.m - 1,
        p.d,
        p.H ?? 0,
        p.M ?? 0,
        Math.floor(p.S ?? 0),
      );
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  let s = String(v).trim().replace(/^\uFEFF/, "");
  s = normalizeFullWidthDigits(s);
  if (!s) return null;
  if (/^\d+(\.0+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (Number.isFinite(serial)) {
      const p = XLSX.SSF.parse_date_code(serial);
      if (p) {
        const d = new Date(
          p.y,
          p.m - 1,
          p.d,
          p.H ?? 0,
          p.M ?? 0,
          Math.floor(p.S ?? 0),
        );
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
    }
  }
  const t = s.replace(/\./g, "-").replace(/\//g, "-");
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const year = defaultYear ?? new Date().getFullYear();
  const kr = parseKoreanDateString(s, year);
  if (kr) return kr.toISOString();
  return null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, "").replace(/\s/g, "").trim();
  if (!s || /^\?+$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseKarat(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (s === "크라운" || s === "인레이") return s;
  const compact = s.replace(/\s/g, "");
  if (compact === "외국금" || s === "외국금") return "외국금";
  if (/^\?+$/.test(compact)) return null;
  let u = s.toUpperCase().replace(/\s/g, "").replace(/[–—‐]/g, "-");
  u = u.replace(/_/g, "-");
  if (
    u === "24K-1" ||
    u.startsWith("24K-1") ||
    u === "24K1" ||
    /^24K-?1$/.test(u)
  ) {
    return "24K-1";
  }
  if (u.includes("18")) return "18K";
  if (u.includes("14")) return "14K";
  if (u.includes("10") && !u.includes("24")) return "10K";
  if (u.includes("24")) return "24K";
  if (KARAT_FACTORS[u]) return u;
  return null;
}

function normalizeSellerPhoneExcel(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const out = normalizeKoreanMobilePhone(s);
  return out.trim() ? out : null;
}

function parseFee(v: unknown): FeeTier | null {
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  if (s.includes("a")) return "a";
  if (s.includes("b")) return "b";
  if (s.includes("c")) return "c";
  if (s === "\uC5C6\uC74C" || s === "none" || s === "-") return "none";
  return null;
}

export type BuildInsertResult = {
  insert: Record<string, unknown>;
  warnings: string[];
};

export function buildPurchaseInsertFromRow(
  row: ExcelImportRow,
  ctx: { branchId: string; createdBy: string; defaultYear?: number },
): { ok: true; value: BuildInsertResult } | { ok: false; error: string } {
  const warnings: string[] = [];
  const defaultYear = ctx.defaultYear ?? new Date().getFullYear();
  const purchasedAt = cellToIso(row.purchased_at, defaultYear);
  if (!purchasedAt) {
    return { ok: false, error: "Date/time column could not be parsed." };
  }
  const total = num(row.total_amount);
  if (total == null) {
    return { ok: false, error: "Amount is missing or not a number." };
  }
  const itemType = str(row.item_type) ?? "\uAE08";
  const sellerName = str(row.seller_name);
  const sellerPhone = normalizeSellerPhoneExcel(row.seller_phone);
  const paymentMethod = str(row.payment_method) ?? "\uD604\uAE08";
  const note = str(row.note);

  const base: Record<string, unknown> = {
    branch_id: ctx.branchId,
    created_by: ctx.createdBy,
    purchased_at: purchasedAt,
    item_type: itemType,
    total_amount: roundWon(total),
    payment_method: paymentMethod,
    note,
    seller_name: sellerName,
    seller_phone: sellerPhone,
  };

  const goldChar = "\uAE08";
  const chigumChar = "\uCE58\uAE08";
  const isGoldLike = itemType === goldChar || itemType === chigumChar;
  if (!isGoldLike) {
    const w = num(row.weight_g);
    const unit = num(row.gold_price_per_don);
    base.weight_g = w;
    base.purity = str(row.karat);
    base.unit_price = unit;
    base.processing_price_per_don = num(row.processing_price_per_don);
    base.margin_amount = null;
    return { ok: true, value: { insert: base, warnings } };
  }

  const weightVal = num(row.weight_g);
  if (weightVal == null || weightVal <= 0) {
    return { ok: false, error: "Gold row needs weight (g)." };
  }
  const karat = parseKarat(row.karat);
  if (!karat) {
    return {
      ok: false,
      error:
        "Karat not recognized (24K, 24K-1, 외국금, 18K, 14K, 10K, 크라운, 인레이).",
    };
  }
  const isChigumRow = itemType === chigumChar;
  let tier: FeeTier = isChigumRow
    ? "a"
    : is24KFamilyNoFee(karat)
      ? "none"
      : karat === "18K" || karat === "14K"
        ? "b"
        : "a";
  if (!isChigumRow && !is24KFamilyNoFee(karat)) {
    const parsed = parseFee(row.fee_tier);
    if (parsed && parsed !== "none") tier = parsed;
  }
  if (isChigumRow) {
    const parsed = parseFee(row.fee_tier);
    if (parsed === "a" || parsed === "b" || parsed === "c") tier = parsed;
  }
  let pDon = num(row.gold_price_per_don);
  if (pDon == null || pDon < 0) {
    const implied = impliedGoldPricePerDonFromTotal({
      weightG: weightVal,
      karat,
      feeTier: tier,
      totalAmount: total,
      chigum: isChigumRow,
    });
    if (implied == null || implied < 0) {
      return {
        ok: false,
        error:
          "Price per don missing (add \uB9E4\uC785\uC2DC\uC138 column or fix amount/weight/K).",
      };
    }
    pDon = implied;
  }
  const excelPureDon = num(row.pure_gold_don_direct);
  const pureGoldGOverride = isForeignGoldKarat(karat)
    ? excelPureDon != null && excelPureDon > 0
      ? excelPureDon * GRAMS_PER_DON
      : weightVal * FOREIGN_GOLD_WEIGHT_MULT
    : undefined;
  const calc = calculateGoldPurchase({
    pricePerDon: pDon,
    weightG: weightVal,
    karat,
    feeTier: tier,
    chigum: isChigumRow,
    pureGoldGOverride,
  });
  if (!calc) {
    return { ok: false, error: "Gold calculation failed." };
  }

  const pureGoldDonStored =
    excelPureDon != null && excelPureDon > 0 ? excelPureDon : calc.pureGoldDon;
  const pureGoldGStored = pureGoldDonStored * GRAMS_PER_DON;
  if (
    excelPureDon != null &&
    excelPureDon > 0 &&
    Math.abs(excelPureDon - calc.pureGoldDon) > 0.02
  ) {
    warnings.push("excel pure don differs from calc; using excel column");
  }

  const proc = num(row.processing_price_per_don);
  let margin: number | null = null;
  if (proc != null && proc >= 0) {
    margin = roundWon(proc - roundWon(total));
  }

  Object.assign(base, {
    weight_g: weightVal,
    purity: karat,
    karat,
    unit_price: pDon,
    gold_price_per_don: pDon,
    purity_factor: KARAT_FACTORS[karat],
    weight_don_raw: calc.weightDonRaw,
    pure_gold_g: pureGoldGStored,
    pure_gold_don: pureGoldDonStored,
    fee_tier: tier,
    processing_price_per_don: proc,
    margin_amount: margin,
  });

  return { ok: true, value: { insert: base, warnings } };
}

export type ExcelParseOutcome = {
  inserts: Record<string, unknown>[];
  rowErrors: { row: number; message: string }[];
  globalWarnings: string[];
};

export function parsePurchaseExcel(
  buffer: ArrayBuffer,
  ctx: { branchId: string; createdBy: string; defaultYear?: number },
): ExcelParseOutcome {
  const defaultYear = ctx.defaultYear ?? new Date().getFullYear();
  const rowCtx = { ...ctx, defaultYear };
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) {
    return {
      inserts: [],
      rowErrors: [{ row: 0, message: "No sheet." }],
      globalWarnings: [],
    };
  }
  const ws = wb.Sheets[name];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(
    ws,
    { header: 1, defval: null, raw: true },
  ) as unknown[][];
  if (!matrix.length) {
    return { inserts: [], rowErrors: [], globalWarnings: [] };
  }
  let headerRowIndex = 0;
  let colMap: Partial<Record<ColKey, number>> = {};
  const maxHeaderScan = Math.min(12, matrix.length);
  for (let h = 0; h < maxHeaderScan; h++) {
    const candidate = matrix[h] as unknown[];
    const next: Partial<Record<ColKey, number>> = {};
    candidate.forEach((cell, i) => {
      const key = mapHeaderToKey(cell);
      if (key != null && next[key] === undefined) next[key] = i;
    });
    if (next.purchased_at !== undefined && next.total_amount !== undefined) {
      colMap = next;
      headerRowIndex = h;
      break;
    }
  }
  if (colMap.purchased_at === undefined || colMap.total_amount === undefined) {
    return {
      inserts: [],
      rowErrors: [
        {
          row: 1,
          message:
            "No header row with date + amount columns. Use e.g. \uB0A0\uC9DC + \uB0B4\uC900\uAE08\uC561 (or \uC77C\uC2DC + \uB9E4\uC785\uAE08\uC561).",
        },
      ],
      globalWarnings: [],
    };
  }

  function get(line: unknown[], k: ColKey): unknown {
    const idx = colMap[k];
    if (idx === undefined) return undefined;
    return line[idx];
  }

  const inserts: Record<string, unknown>[] = [];
  const rowErrors: { row: number; message: string }[] = [];
  const globalWarnings: string[] = [];

  let carryPurchasedAtIso: string | null = null;
  let carrySellerName: string | null = null;
  let carrySellerPhone: string | null = null;
  let carryProcessingPerDon: number | null = null;

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const line = matrix[r] as unknown[];
    if (
      !line ||
      !line.some((c) => c !== null && c !== undefined && String(c).trim() !== "")
    ) {
      continue;
    }
    const rawDate = get(line, "purchased_at");
    const hasDateCell =
      rawDate != null &&
      rawDate !== "" &&
      String(rawDate).replace(/\s/g, "") !== "";
    let purchasedAtVal: unknown = rawDate;
    if (hasDateCell) {
      const iso = cellToIso(rawDate, defaultYear);
      if (iso) carryPurchasedAtIso = iso;
    }
    if (!hasDateCell && carryPurchasedAtIso) {
      purchasedAtVal = carryPurchasedAtIso;
    }

    const rawName = get(line, "seller_name");
    const nameStr = str(rawName);
    if (nameStr) carrySellerName = nameStr;
    const effectiveName = nameStr ?? carrySellerName;

    const rawPhone = get(line, "seller_phone");
    const normalizedPhone = normalizeSellerPhoneExcel(rawPhone);
    if (normalizedPhone) carrySellerPhone = normalizedPhone;
    const effectivePhone = normalizedPhone ?? carrySellerPhone;

    const rawProc = get(line, "processing_price_per_don");
    const procParsed = num(rawProc);
    if (procParsed != null && procParsed >= 0) {
      carryProcessingPerDon = procParsed;
    }
    const effectiveProc =
      procParsed != null && procParsed >= 0
        ? procParsed
        : carryProcessingPerDon;

    const excelRow: ExcelImportRow = {
      purchased_at: purchasedAtVal,
      seller_name: effectiveName,
      seller_phone: effectivePhone,
      item_type: get(line, "item_type"),
      weight_g: get(line, "weight_g"),
      karat: get(line, "karat"),
      fee_tier: get(line, "fee_tier"),
      gold_price_per_don: get(line, "gold_price_per_don"),
      total_amount: get(line, "total_amount"),
      payment_method: get(line, "payment_method"),
      note: get(line, "note"),
      processing_price_per_don:
        effectiveProc != null && effectiveProc >= 0 ? effectiveProc : undefined,
      pure_gold_don_direct: get(line, "pure_gold_don_direct"),
    };
    const built = buildPurchaseInsertFromRow(excelRow, rowCtx);
    if (!built.ok) {
      rowErrors.push({ row: r + 1, message: built.error });
      continue;
    }
    if (built.value.warnings.length) {
      globalWarnings.push(`Row ${r + 1}: ${built.value.warnings.join(" ")}`);
    }
    inserts.push(built.value.insert);
  }

  inserts.sort((a, b) => {
    const ta = String(a.purchased_at ?? "");
    const tb = String(b.purchased_at ?? "");
    const c = ta.localeCompare(tb);
    if (c !== 0) return c;
    return 0;
  });

  return { inserts, rowErrors, globalWarnings };
}

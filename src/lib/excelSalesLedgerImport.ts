import * as XLSX from "xlsx";
import { normalizeKoreanMobilePhone } from "@/lib/koreanPhone";

export type SalesLedgerExcelRow = {
  sheetRow: number;
  sold_at: string;
  kind: string;
  name: string;
  product_name: string | null;
  quantity: number;
  weight_g: number | null;
  labor_fee: number | null;
  sell_price: number;
  cost_price: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  payment_method: string;
  note: string | null;
  vendor_name?: string | null;
  order_ref?: string | null;
  size?: string | null;
};

export type SalesLedgerExcelParseResult = {
  rows: SalesLedgerExcelRow[];
  rowErrors: { row: number; message: string }[];
  fromDate: string | null;
  toDate: string | null;
};

function normHeaderCell(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .normalize("NFC");
}

/** 한글 헤더명 — JSON \\u 이스케이프만 써서 소스 인코딩과 무관하게 매칭 */
const XH = JSON.parse(
  '{"date":"\\ub0a0\\uc9dc","pum":"\\ud488\\uba85","prod":"\\uc81c\\ud488\\uba85","sang":"\\uc0c1\\ud488\\uba85","ham":"\\ud568\\ub7c9","sell":"\\ud310\\ub9e4\\uac00","sell2":"\\ud310\\ub9e4\\uae08\\uc561","amt":"\\uae08\\uc561","kind":"\\ud488\\ubaa9","code":"\\uc81c\\ud488\\ucf54\\ub4dc","codeAlt":"\\ucf54\\ub4dc","sku":"SKU","cust":"\\uace0\\uac1d\\uba85","custAlt":"\\uc131\\uba85","nameAlt":"\\uc774\\ub984","phone":"\\uc804\\ud654\\ubc88\\ud638","phoneAlt":"\\ubc88\\ud638","phone2":"\\uc5f0\\ub77d\\ucc98","phone3":"\\ud734\\ub300\\ud3f0","qty":"\\uc218\\ub7c9","qtyAlt":"\\uac1c\\uc218","wg":"\\uc911\\ub7c9(g)","w":"\\uc911\\ub7c9","labor":"\\uacf5\\uc784","cost":"\\uc6d0\\uac00","costAlt":"\\ub9e4\\uc785\\uc6d0\\uac00","vendor":"\\uc5c5\\uccb4\\uba85","jumun":"\\ubc1c\\uc8fc","hosu":"\\ud638\\uc218","pay":"\\uacb0\\uc81c\\ubc29\\uc2dd","pay2":"\\uacb0\\uc81c","pay3":"\\uacb0\\uc81c\\uc218\\ub2e8","note":"\\ube44\\uace0","memo":"\\uba54\\ubaa8","note2":"\\ud2b9\\uc774\\uc0ac\\ud56d","kindAlt":"\\uc885\\ub958","sellAlt":"\\ub9e4\\ucd9c\\uc561","cash":"\\ud604\\uae08","fulfil":"\\uc989\\uc2dc\\ucd9c\\uace0","naeJun":"\\ub0b4\\uc900\\uae08\\uc561","jongroWon":"\\uc885\\ub85c\\uc6d0\\uac00"}',
) as Readonly<{
  date: string;
  pum: string;
  prod: string;
  sang: string;
  ham: string;
  sell: string;
  sell2: string;
  amt: string;
  kind: string;
  code: string;
  codeAlt: string;
  sku: string;
  cust: string;
  custAlt: string;
  nameAlt: string;
  phone: string;
  phoneAlt: string;
  phone2: string;
  phone3: string;
  qty: string;
  qtyAlt: string;
  wg: string;
  w: string;
  labor: string;
  cost: string;
  costAlt: string;
  vendor: string;
  jumun: string;
  hosu: string;
  pay: string;
  pay2: string;
  pay3: string;
  note: string;
  memo: string;
  note2: string;
  kindAlt: string;
  sellAlt: string;
  cash: string;
  fulfil: string;
  naeJun: string;
  jongroWon: string;
}>;

function parseNumberLike(s: string): number | null {
  const t = String(s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/,/g, "");
  if (t === "" || t === "-") return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

function parseMonthDayText(s: string): { m: number; d: number } | null {
  const m = s.match(/^\s*(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C\s*$/);
  if (!m) return null;
  return { m: Number(m[1]), d: Number(m[2]) };
}

function toIsoNoonLocal(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

function ymdFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function parseDateCell(
  raw: unknown,
  yearHint: number,
): { iso: string; ymd: string } | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const iso = raw.toISOString();
    return { iso, ymd: ymdFromLocalDate(raw) };
  }
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const md = parseMonthDayText(s);
  if (md) {
    const d = new Date(yearHint, md.m - 1, md.d);
    if (d.getMonth() !== md.m - 1) return null;
    return { iso: toIsoNoonLocal(yearHint, md.m, md.d), ymd: ymdFromLocalDate(d) };
  }

  const isoYmd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoYmd) {
    const y = Number(isoYmd[1]);
    const mo = Number(isoYmd[2]);
    const da = Number(isoYmd[3]);
    const d = new Date(y, mo - 1, da);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) {
      return null;
    }
    return { iso: toIsoNoonLocal(y, mo, da), ymd: `${isoYmd[1]}-${isoYmd[2]}-${isoYmd[3]}` };
  }

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    const mo = Number(slash[1]);
    const da = Number(slash[2]);
    const d = new Date(y, mo - 1, da);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) {
      return null;
    }
    return { iso: toIsoNoonLocal(y, mo, da), ymd: ymdFromLocalDate(d) };
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = epoch.getTime() + raw * 86400000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return {
      iso: toIsoNoonLocal(
        local.getFullYear(),
        local.getMonth() + 1,
        local.getDate(),
      ),
      ymd: ymdFromLocalDate(local),
    };
  }

  return null;
}

export function normalizeSalesKindFromExcelCell(s: unknown): string | null {
  const t = String(s ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!t) return null;
  const u = t.toUpperCase();
  if (u === "18K" || t === "18k" || t.includes("18K")) return "gold_18k";
  if (u === "14K" || t === "14k" || t.includes("14K")) return "gold_14k";
  if (t.includes("\uC740") || u === "SILVER" || u === "AG" || u === "S925") return "silver";
  if (t.includes("\uAE30\uD0C0") || u === "OTHER") return "other";
  if (
    t.includes("\uAE08") ||
    u.includes("24K") ||
    u === "GOLD" ||
    t === "\uC21C\uAE08" ||
    t.includes("99\uAE08")
  ) {
    return "gold";
  }
  return null;
}

function purityForKind(kind: string): string | null {
  if (kind === "gold_18k") return "18K";
  if (kind === "gold_14k") return "14K";
  return null;
}

export function kindFromHamryangAndProduct(
  hamRaw: unknown,
  productNameRaw: unknown,
): string | null {
  const pum = String(productNameRaw ?? "").trim();
  const u = pum.toUpperCase();
  if (
    pum.includes("\uC2E4\uBC84") ||
    pum.includes("\uC740") ||
    u.includes("SILVER") ||
    u.includes("S925") ||
    u.includes("AG")
  ) {
    return "silver";
  }
  const h = String(hamRaw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!h) return null;
  if (h.includes("18K")) return "gold_18k";
  if (h.includes("14K")) return "gold_14k";
  if (h.includes("10K")) return "other";
  if (h.includes("24K") || h.includes("24K-1")) return "gold";
  if (h.includes("\uC678\uAD6D\uAE08")) return "gold";
  return null;
}

function rowHasExactDateCell(row: unknown[]): boolean {
  for (let c = 0; c < row.length; c++) {
    if (normHeaderCell(row[c]) === XH.date) return true;
  }
  return false;
}

/** '날짜' 셀이 있는 행 후보 중, 품명·함량·판매가 등이 갖춰진 실제 표 헤더 행을 고름 */
function findBestHeaderRow(grid: unknown[][]): number {
  const candidates: number[] = [];
  const maxR = Math.min(80, grid.length);
  for (let r = 0; r < maxR; r++) {
    if (rowHasExactDateCell(grid[r] ?? [])) candidates.push(r);
  }
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0];

  const idxIn = (header: string[], label: string) => header.findIndex((h) => h === label);

  const scoreHeader = (header: string[]): number => {
    const hasPum =
      idxIn(header, XH.pum) >= 0 ||
      idxIn(header, XH.prod) >= 0 ||
      idxIn(header, XH.sang) >= 0;
    const hasHam = idxIn(header, XH.ham) >= 0;
    const hasSell =
      idxIn(header, XH.sell) >= 0 ||
      idxIn(header, XH.sell2) >= 0 ||
      idxIn(header, XH.amt) >= 0;
    const hasKind = idxIn(header, XH.kind) >= 0;
    const hasCode = idxIn(header, XH.code) >= 0;
    let s = 0;
    if (hasPum && hasHam && hasSell) s += 10_000;
    if (hasKind && hasCode && hasSell) s += 5_000;
    if (hasPum) s += 200;
    if (hasHam) s += 200;
    if (hasSell) s += 200;
    if (hasKind) s += 50;
    if (hasCode) s += 50;
    const nonEmpty = header.filter((x) => x.length > 0).length;
    s += Math.min(nonEmpty, 30);
    return s;
  };

  let best = candidates[0];
  let bestScore = -1;
  for (const r of candidates) {
    const header = (grid[r] ?? []).map(normHeaderCell);
    const sc = scoreHeader(header);
    if (sc > bestScore) {
      bestScore = sc;
      best = r;
    }
  }
  return best;
}

function parseNeighborhoodSalesExcel(
  grid: unknown[][],
  headerRow: number,
  yearHint: number,
): SalesLedgerExcelParseResult {
  const header = (grid[headerRow] ?? []).map(normHeaderCell);
  const idx = (name: string) => header.findIndex((h) => h === name);
  const idxAny = (...names: string[]) => {
    for (const n of names) {
      const i = idx(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iDate = idx(XH.date);
  const iCust = idxAny(XH.cust, XH.custAlt);
  const iPhone = idxAny(XH.phone, XH.phoneAlt, XH.phone2, XH.phone3);
  const iPum = idxAny(XH.pum, XH.prod, XH.sang);
  const iQty = idxAny(XH.qty, XH.qtyAlt);
  const iLabor = idx(XH.labor);
  const iWeight = idxAny(XH.wg, XH.w);
  const iHam = idx(XH.ham);
  const iSell = idxAny(XH.sell, XH.sell2, XH.amt);
  const iCost = idxAny(XH.cost, XH.costAlt);
  const iVendor = idx(XH.vendor);
  const iJumun = idx(XH.jumun);
  const iHosu = idx(XH.hosu);
  const iPay = idxAny(XH.pay, XH.pay2, XH.pay3);

  const missing: string[] = [];
  if (iDate < 0) missing.push(XH.date);
  if (iPum < 0) missing.push(`${XH.pum}/${XH.prod}`);
  if (iHam < 0) missing.push(XH.ham);
  if (iSell < 0) missing.push(XH.sell);
  if (missing.length) {
    return {
      rows: [],
      rowErrors: [
        {
          row: headerRow + 1,
          message: "Missing columns: " + missing.join(", "),
        },
      ],
      fromDate: null,
      toDate: null,
    };
  }

  const out: SalesLedgerExcelRow[] = [];
  const rowErrors: { row: number; message: string }[] = [];
  let carryDateRaw: unknown = "";
  let carryCust = "";
  let carryPhone = "";

  let minYmd: string | null = null;
  let maxYmd: string | null = null;
  const bumpRange = (ymd: string) => {
    if (!minYmd || ymd < minYmd) minYmd = ymd;
    if (!maxYmd || ymd > maxYmd) maxYmd = ymd;
  };

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const sheetRow = r + 1;

    const rawDate = row[iDate];
    if (String(rawDate ?? "").trim()) carryDateRaw = rawDate;

    const cRaw = iCust >= 0 ? String(row[iCust] ?? "").trim() : "";
    if (cRaw) carryCust = cRaw;

    const ph = iPhone >= 0 ? String(row[iPhone] ?? "").trim() : "";
    if (ph) carryPhone = ph;

    const pum = String(row[iPum] ?? "").trim();
    const sellNum =
      typeof row[iSell] === "number" && Number.isFinite(Number(row[iSell]))
        ? Math.round(Number(row[iSell]))
        : parseNumberLike(String(row[iSell] ?? ""));

    if (!carryDateRaw && !pum && sellNum == null) continue;

    const parsedDate = parseDateCell(carryDateRaw, yearHint);
    if (!parsedDate) {
      if (String(carryDateRaw ?? "").trim()) {
        rowErrors.push({
          row: sheetRow,
          message: "Bad date: " + String(carryDateRaw).trim(),
        });
      }
      continue;
    }

    if (!pum) {
      if (sellNum != null) {
        rowErrors.push({ row: sheetRow, message: "Empty product name" });
      }
      continue;
    }

    if (sellNum == null) continue;

    const hamCell = row[iHam];
    const kind = kindFromHamryangAndProduct(hamCell, pum);
    if (!kind) {
      const hTrim = String(hamCell ?? "").trim();
      rowErrors.push({
        row: sheetRow,
        message: "Kind from ham/pum: ham=" + hTrim + " pum=" + pum.slice(0, 40),
      });
      continue;
    }

    const qtyRaw = iQty >= 0 ? row[iQty] : "";
    let qty =
      typeof qtyRaw === "number" && Number.isFinite(qtyRaw)
        ? qtyRaw
        : parseNumberLike(String(qtyRaw ?? ""));
    if (qty == null || qty <= 0) qty = 1;

    const wRaw = iWeight >= 0 ? row[iWeight] : "";
    const weight =
      typeof wRaw === "number" && Number.isFinite(wRaw)
        ? wRaw
        : parseNumberLike(String(wRaw ?? ""));

    const labRaw = iLabor >= 0 ? row[iLabor] : "";
    const labor =
      typeof labRaw === "number" && Number.isFinite(labRaw)
        ? labRaw
        : parseNumberLike(String(labRaw ?? ""));

    const costRaw = iCost >= 0 ? row[iCost] : "";
    const cost =
      typeof costRaw === "number" && Number.isFinite(costRaw)
        ? Math.round(costRaw)
        : (() => {
            const p = parseNumberLike(String(costRaw ?? ""));
            return p != null ? Math.round(p) : null;
          })();

    const payRaw = iPay >= 0 ? String(row[iPay] ?? "").trim() : "";
    const payment_method = payRaw || XH.cash;

    const vendor = iVendor >= 0 ? String(row[iVendor] ?? "").trim() || null : null;
    const jum = iJumun >= 0 ? String(row[iJumun] ?? "").trim() : "";
    const hosu = iHosu >= 0 ? String(row[iHosu] ?? "").trim() : "";
    const order_ref = jum || null;
    const sizeOut = hosu || null;

    const nameShort = pum.length > 80 ? pum.slice(0, 80) : pum;
    const phoneNorm = carryPhone ? normalizeKoreanMobilePhone(carryPhone) : null;

    out.push({
      sheetRow,
      sold_at: parsedDate.iso,
      kind,
      name: nameShort,
      product_name: pum,
      quantity: qty,
      weight_g: weight,
      labor_fee: labor,
      sell_price: sellNum,
      cost_price: cost,
      customer_name: carryCust || null,
      customer_phone: phoneNorm ?? null,
      payment_method,
      note: null,
      vendor_name: vendor,
      order_ref,
      size: sizeOut,
    });
    bumpRange(parsedDate.ymd);
  }

  return { rows: out, rowErrors, fromDate: minYmd, toDate: maxYmd };
}

function parseClassicSalesExcel(
  grid: unknown[][],
  headerRow: number,
  yearHint: number,
): SalesLedgerExcelParseResult {
  const header = (grid[headerRow] ?? []).map(normHeaderCell);
  const idx = (name: string) => header.findIndex((h) => h === name);
  const idxAny = (...names: string[]) => {
    for (const n of names) {
      const i = idx(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iDate = idx(XH.date);
  const iKind = idxAny(XH.kind, XH.kindAlt);
  const iCode = idxAny(XH.code, XH.codeAlt, XH.sku);
  const iProdName = idxAny(XH.prod, XH.sang);
  const iQty = idxAny(XH.qty, XH.qtyAlt);
  const iWeight = idxAny(XH.wg, XH.w);
  const iLabor = idx(XH.labor);
  const iSell = idxAny(XH.sell, XH.sellAlt, XH.amt, XH.sell2);
  const iCost = idxAny(XH.cost, XH.costAlt);
  const iCust = idxAny(XH.cust, XH.custAlt, XH.nameAlt);
  const iPhone = idxAny(XH.phone, XH.phoneAlt, XH.phone2, XH.phone3);
  const iPay = idxAny(XH.pay, XH.pay2, XH.pay3);
  const iNote = idxAny(XH.note, XH.memo, XH.note2);

  const required: [string, number][] = [
    [XH.date, iDate],
    [XH.kind, iKind],
    [XH.code, iCode],
    [XH.sell, iSell],
  ];
  const missing = required.filter(([, i]) => i < 0).map(([n]) => n);
  if (missing.length) {
    return {
      rows: [],
      rowErrors: [
        {
          row: headerRow + 1,
          message: "Missing columns: " + missing.join(", "),
        },
      ],
      fromDate: null,
      toDate: null,
    };
  }

  const out: SalesLedgerExcelRow[] = [];
  const rowErrors: { row: number; message: string }[] = [];

  let carryDateRaw: unknown = "";
  let carryKind = "";
  let carryCust = "";
  let carryPhone = "";

  let minYmd: string | null = null;
  let maxYmd: string | null = null;

  const bumpRange = (ymd: string) => {
    if (!minYmd || ymd < minYmd) minYmd = ymd;
    if (!maxYmd || ymd > maxYmd) maxYmd = ymd;
  };

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const sheetRow = r + 1;

    const rawDate = row[iDate];
    if (String(rawDate ?? "").trim()) carryDateRaw = rawDate;

    const rawKindCell = row[iKind];
    const kindStr = String(rawKindCell ?? "").trim();
    if (kindStr) carryKind = kindStr;

    const rawCust = iCust >= 0 ? String(row[iCust] ?? "").trim() : "";
    if (rawCust) carryCust = rawCust;

    const phoneCell = iPhone >= 0 ? row[iPhone] : "";
    const phoneStr = String(phoneCell ?? "").trim();
    if (phoneStr) carryPhone = phoneStr;

    const codeRaw = String(row[iCode] ?? "").trim();
    const sellRaw = row[iSell];
    const sellNum =
      typeof sellRaw === "number" && Number.isFinite(sellRaw)
        ? Math.round(sellRaw)
        : parseNumberLike(String(sellRaw ?? ""));

    if (!carryDateRaw && !codeRaw && sellNum == null) continue;

    const parsedDate = parseDateCell(carryDateRaw, yearHint);
    if (!parsedDate) {
      if (carryDateRaw) {
        rowErrors.push({
          row: sheetRow,
          message: "Bad date: " + String(carryDateRaw).trim(),
        });
      }
      continue;
    }

    const kind = normalizeSalesKindFromExcelCell(carryKind);
    if (!kind) {
      rowErrors.push({
        row: sheetRow,
        message: "Bad kind: " + carryKind,
      });
      continue;
    }

    if (!codeRaw) {
      rowErrors.push({ row: sheetRow, message: "Empty product code" });
      continue;
    }

    if (sellNum == null) {
      const laborOnly =
        iLabor >= 0 ? parseNumberLike(String(row[iLabor] ?? "")) : null;
      const wOnly =
        iWeight >= 0 ? parseNumberLike(String(row[iWeight] ?? "")) : null;
      if (laborOnly == null && wOnly == null) continue;
      rowErrors.push({ row: sheetRow, message: "Empty sell price" });
      continue;
    }

    const qtyRaw = iQty >= 0 ? row[iQty] : "";
    let qty =
      typeof qtyRaw === "number" && Number.isFinite(qtyRaw)
        ? qtyRaw
        : parseNumberLike(String(qtyRaw ?? ""));
    if (qty == null || qty <= 0) qty = 1;

    const wRaw = iWeight >= 0 ? row[iWeight] : "";
    const weight =
      typeof wRaw === "number" && Number.isFinite(wRaw)
        ? wRaw
        : parseNumberLike(String(wRaw ?? ""));

    const labRaw = iLabor >= 0 ? row[iLabor] : "";
    const labor =
      typeof labRaw === "number" && Number.isFinite(labRaw)
        ? labRaw
        : parseNumberLike(String(labRaw ?? ""));

    const costRaw = iCost >= 0 ? row[iCost] : "";
    const cost =
      typeof costRaw === "number" && Number.isFinite(costRaw)
        ? Math.round(costRaw)
        : (() => {
            const p = parseNumberLike(String(costRaw ?? ""));
            return p != null ? Math.round(p) : null;
          })();

    const prodName =
      iProdName >= 0 ? String(row[iProdName] ?? "").trim() || null : null;
    const payRaw = iPay >= 0 ? String(row[iPay] ?? "").trim() : "";
    const payment_method = payRaw || XH.cash;
    const noteRaw = iNote >= 0 ? String(row[iNote] ?? "").trim() : "";
    const note = noteRaw || null;

    const phoneNorm = carryPhone ? normalizeKoreanMobilePhone(carryPhone) : null;

    out.push({
      sheetRow,
      sold_at: parsedDate.iso,
      kind,
      name: codeRaw,
      product_name: prodName,
      quantity: qty,
      weight_g: weight,
      labor_fee: labor,
      sell_price: sellNum,
      cost_price: cost,
      customer_name: carryCust || null,
      customer_phone: phoneNorm ?? null,
      payment_method,
      note,
    });
    bumpRange(parsedDate.ymd);
  }

  return { rows: out, rowErrors, fromDate: minYmd, toDate: maxYmd };
}

export function parseSalesLedgerExcel(
  buf: ArrayBuffer,
  yearHint: number,
): SalesLedgerExcelParseResult {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sh = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sh, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];

  const headerRow = findBestHeaderRow(grid);
  if (headerRow === -1) {
    return {
      rows: [],
      rowErrors: [{ row: 0, message: "Header row with date column not found" }],
      fromDate: null,
      toDate: null,
    };
  }

  const header = (grid[headerRow] ?? []).map(normHeaderCell);
  const hIdx = (name: string) => header.findIndex((h) => h === name);

  /** 매출 화면에 동네금빵 식 「매입」장부 엑셀을 올린 경우 — 월매입 장부로 안내 */
  const sheetLooksPurchaseOnly =
    sheetName.includes("\uB9E4\uC785") && !sheetName.includes("\uB9E4\uCD9C");
  const hasSalesProductCol =
    hIdx(XH.pum) >= 0 || hIdx(XH.prod) >= 0 || hIdx(XH.sang) >= 0 || hIdx(XH.kind) >= 0;
  const hasPurchaseCols =
    hIdx(XH.ham) >= 0 &&
    (hIdx(XH.naeJun) >= 0 || hIdx(XH.jongroWon) >= 0) &&
    !hasSalesProductCol;
  if (sheetLooksPurchaseOnly || hasPurchaseCols) {
    return {
      rows: [],
      rowErrors: [
        {
          row: headerRow + 1,
          message:
            "이 파일은 매입 장부 형식입니다. 금 매입·엑셀 일괄등록은 메뉴의 「월매입 장부」에서 업로드해 주세요. 매출(판매) 장부에는 품명·함량·판매가(또는 품목·제품코드·판매가) 열이 있는 엑셀을 사용합니다.",
        },
      ],
      fromDate: null,
      toDate: null,
    };
  }

  const hasNeighborhoodProductCol =
    hIdx(XH.pum) >= 0 || hIdx(XH.prod) >= 0 || hIdx(XH.sang) >= 0;
  const isNeighborhoodLedger = hasNeighborhoodProductCol && hIdx(XH.ham) >= 0;

  if (isNeighborhoodLedger) {
    return parseNeighborhoodSalesExcel(grid, headerRow, yearHint);
  }

  return parseClassicSalesExcel(grid, headerRow, yearHint);
}

export function inventoryInsertFromSalesExcelRow(
  r: SalesLedgerExcelRow,
): Record<string, unknown> {
  const fs = XH.fulfil;
  return {
    sold_at: r.sold_at,
    name: r.name.trim(),
    kind: r.kind,
    quantity: r.quantity,
    unit: "g",
    product_name: r.product_name,
    labor_fee: r.labor_fee,
    weight_g: r.weight_g,
    purity: purityForKind(r.kind),
    sell_price: r.sell_price,
    cost_price: r.cost_price,
    payment_method: r.payment_method,
    customer_name: r.customer_name,
    customer_phone: r.customer_phone,
    receivable_won: null,
    received: true,
    shipped: true,
    fulfillment_status: fs,
    vendor_name: r.vendor_name ?? null,
    order_ref: r.order_ref ?? null,
    size: r.size ?? null,
    note: r.note,
  };
}

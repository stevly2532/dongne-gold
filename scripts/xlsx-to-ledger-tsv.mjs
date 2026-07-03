import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";

// Usage:
//   node scripts/xlsx-to-ledger-tsv.mjs "<input.xlsx>" "<output.tsv>"

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error(
    'Usage: node scripts/xlsx-to-ledger-tsv.mjs "<input.xlsx>" "<output.tsv>"',
  );
  process.exit(1);
}

const wb = XLSX.readFile(inPath, { cellDates: true });
const sh = wb.Sheets[wb.SheetNames[0]];
const grid = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: "" });

let headerRow = -1;
for (let r = 0; r < Math.min(40, grid.length); r++) {
  if (String((grid[r] || [])[0] ?? "").trim() === "날짜") {
    headerRow = r;
    break;
  }
}
if (headerRow < 0) throw new Error("Header row not found (날짜)");

const header = (grid[headerRow] || []).map((v) => String(v ?? "").trim());
const idx = (name) => header.findIndex((h) => h === name);
const idxAny = (...names) => {
  for (const n of names) {
    const i = idx(n);
    if (i >= 0) return i;
  }
  return -1;
};

const iDate = idx("날짜");
const iName = idx("고객명");
const iPhone = idx("번호");
const iWeight = idx("중량");
const iPure = idx("순금");
const iKarat = idx("함량");
const iPaid = idxAny("매입금액", "내준금액");
const iCost = idxAny("처리원가", "종로원가");
const iMargin = idx("마진");
const iPrice = idxAny("처리 시세", "처리시세", "종로 시세", "종로시세");

const req = [
  iDate,
  iName,
  iPhone,
  iWeight,
  iPure,
  iKarat,
  iPaid,
  iCost,
  iMargin,
  iPrice,
];
if (req.some((i) => i < 0)) throw new Error("Missing required columns");

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function toMonthDay(d) {
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  let day = kst.getUTCDate();
  const h = kst.getUTCHours();
  if (h >= 18) {
    const next = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), day) + 86400000);
    day = next.getUTCDate();
  }
  return `3월 ${day}일`;
}

let carryDate = null;
let carryName = "";
let carryPhone = "";
let carryPrice = "";

const out = [];
out.push(
  ["날짜", "고객명", "번호", "중량", "순금", "함량", "매입금액", "처리원가", "마진", "처리 시세"].join(
    "\t",
  ),
);

for (let r = headerRow + 1; r < grid.length; r++) {
  const row = grid[r] || [];
  const rawDate = row[iDate];
  if (rawDate instanceof Date) carryDate = rawDate;

  const name = String(row[iName] ?? "").trim();
  const phone = String(row[iPhone] ?? "").trim();
  const price = row[iPrice];
  if (name) carryName = name;
  if (phone) carryPhone = phone;
  if (price !== "" && price != null) carryPrice = String(price).trim();

  const paid = row[iPaid];
  if (!carryDate) continue;
  if (paid === "" || paid == null) continue;

  const dateMD = toMonthDay(carryDate);
  const line = [
    dateMD,
    carryName,
    carryPhone,
    row[iWeight],
    row[iPure],
    row[iKarat],
    row[iPaid],
    row[iCost],
    row[iMargin],
    carryPrice,
  ].map((v) => String(v ?? "").trim());

  out.push(line.join("\t"));
}

fs.writeFileSync(outPath, out.join("\n"), "utf8");
console.log(`Wrote ${out.length - 1} rows to ${path.resolve(outPath)}`);


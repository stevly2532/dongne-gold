import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createWorker } from "tesseract.js";

/**
 * Usage:
 *   node scripts/ocr-ledger.mjs <image1> [image2 ...]
 *
 * Output:
 *   - Prints a best-effort TSV (tab-separated) for pasting.
 *   - Also prints raw OCR text to help manual correction.
 */

function usage() {
  console.error("Usage: node scripts/ocr-ledger.mjs <image1> [image2 ...]");
}

const args = process.argv.slice(2);
if (args.length === 0) {
  usage();
  process.exit(1);
}

const imagePaths = args.map((p) => path.resolve(p));
for (const p of imagePaths) {
  if (!fs.existsSync(p)) {
    console.error(`File not found: ${p}`);
    process.exit(1);
  }
}

const worker = await createWorker("kor+eng", 1, {
  logger: (m) => {
    if (m?.status && typeof m?.progress === "number") {
      const pct = Math.round(m.progress * 100);
      process.stderr.write(`\r${m.status} ${pct}%`.padEnd(30));
    }
  },
});

await worker.setParameters({
  preserve_interword_spaces: "1",
  tessedit_pageseg_mode: "6",
  tessjs_create_hocr: "1",
  tessjs_create_tsv: "1",
});

function parseHocrWords(hocr) {
  const html = String(hocr || "");
  const out = [];
  const re =
    /<span[^>]*class=['"]ocrx_word['"][^>]*title=['"][^'"]*bbox (\d+) (\d+) (\d+) (\d+)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const x0 = Number(m[1]);
    const y0 = Number(m[2]);
    const x1 = Number(m[3]);
    const y1 = Number(m[4]);
    const text = String(m[5])
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (!text) continue;
    out.push({
      left: x0,
      top: y0,
      right: x1,
      bottom: y1,
      width: x1 - x0,
      height: y1 - y0,
      text,
      cy: (y0 + y1) / 2,
    });
  }
  return out;
}

function estimateWidth(words) {
  let max = 0;
  for (const w of words) {
    if (w.right > max) max = w.right;
  }
  return max || 1;
}

function groupByYLines(words) {
  const sorted = [...words].sort((a, b) => a.cy - b.cy || a.left - b.left);
  const medianH = (() => {
    const hs = sorted.map((w) => w.height).sort((a, b) => a - b);
    return hs.length ? hs[Math.floor(hs.length / 2)] : 14;
  })();
  const tol = Math.max(6, Math.round(medianH * 0.6));
  const lines = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.cy - w.cy) > tol) {
      lines.push({ cy: w.cy, words: [w] });
    } else {
      last.words.push(w);
      last.cy = (last.cy * (last.words.length - 1) + w.cy) / last.words.length;
    }
  }
  return lines.map((l) => l.words.sort((a, b) => a.left - b.left));
}

function toLedgerRows(lineWords, imgWidth) {
  // Column thresholds tuned for the screenshot template.
  // [날짜|고객명|번호|중량|순금|함량|매입금액|처리원가|마진|처리시세|비고...]
  const cuts = [
    0.08, // date
    0.20, // name
    0.36, // phone
    0.45, // weight
    0.53, // pure
    0.60, // karat
    0.72, // paid
    0.83, // cost
    0.92, // margin
    0.99, // price
  ].map((p) => p * imgWidth);

  const rows = [];
  for (const words of lineWords) {
    const cols = Array.from({ length: 10 }, () => []);
    for (const w of words) {
      const x = w.left;
      let c = 9;
      for (let i = 0; i < cuts.length; i++) {
        if (x < cuts[i]) {
          c = i;
          break;
        }
      }
      cols[c].push(w.text);
    }
    const joined = cols.map((c) => c.join(" ").replace(/\s+/g, " ").trim());
    const any = joined.some(Boolean);
    if (!any) continue;

    // Skip obvious headers
    const headerish =
      joined.join(" ").includes("고객명") ||
      joined.join(" ").includes("매입금액") ||
      joined.join(" ").includes("내준금액");
    if (headerish) continue;

    rows.push(joined);
  }
  return rows;
}

function extractLedgerRowsFromText(text) {
  const lines = String(text || "")
    .replace(/\u00A0/g, " ")
    .split(/\r?\n/g)
    .map((l) => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const out = [];
  let lastDate = "";

  const phoneRe = /^0\d{1,2}[-.]?\d{3,4}[-.]?\d{4}$/;
  const numRe = /^[0-9][0-9,]*$/;

  function mapKaratToken(tok) {
    const t = tok.toLowerCase().replace(/\s+/g, "");
    if (t === "24k-1" || t === "24k1") return "24K-1";
    if (t === "24k") return "24K";
    if (t === "18k") return "18K";
    if (t === "14k") return "14K";
    if (t === "10k") return "10K";
    // OCR often turns 24k/18k/14k/10k into 206/186/146/106 or similar.
    if (/^\d{3}$/.test(t)) {
      if (t.startsWith("24")) return t.endsWith("1") ? "24K-1" : "24K";
      if (t.startsWith("18")) return "18K";
      if (t.startsWith("14")) return "14K";
      if (t.startsWith("10")) return "10K";
      if (t === "206") return "24K";
      if (t === "186") return "18K";
      if (t === "146") return "14K";
      if (t === "106") return "10K";
    }
    return null;
  }

  function parseDatePrefix(tokens) {
    // Handles: "3월 6일", "3월6일", or OCR-mashed like "3868" meaning 3월6일
    const joined = tokens.slice(0, 3).join(" ");
    let m = joined.match(/3\s*월\s*(\d{1,2})\s*일/);
    if (m) return `3월 ${Number(m[1])}일`;
    m = tokens[0]?.match(/^3(\d{1,2})$/);
    if (m) return `3월 ${Number(m[1])}일`;
    const t0 = tokens[0] || "";
    // e.g. "3868" -> treat as 3월 6일 (OCR mashed extra digits)
    if (/^3\d{3,4}$/.test(t0)) {
      const day = t0.length === 4 ? t0[1] : t0.slice(1, 3);
      return `3월 ${Number(day)}일`;
    }
    return null;
  }

  for (const l of lines) {
    const tokens = l.split(" ").filter(Boolean);
    if (tokens.length < 6) continue;

    const d = parseDatePrefix(tokens);
    if (d) lastDate = d;

    const phoneIdx = tokens.findIndex((t) => phoneRe.test(t.replace(/\s+/g, "")));
    if (phoneIdx === -1) continue;

    // Name is the token just before phone (best-effort)
    const name = tokens[phoneIdx - 1] ?? "";
    const phone = tokens[phoneIdx].replace(/\./g, "-");

    // After phone: weight, pure, karat, paid, cost, margin, price
    const tail = tokens.slice(phoneIdx + 1);
    if (tail.length < 6) continue;

    const weight = tail[0] ?? "";
    const pure = tail[1] ?? "";
    const karat = mapKaratToken(tail[2] ?? "");
    const paidTok = tail.find((t, i) => i >= 3 && numRe.test(t));
    const paidIdx = tail.findIndex((t, i) => i >= 3 && numRe.test(t));
    if (!karat || paidIdx === -1) continue;
    const nums = tail.slice(paidIdx).filter((t) => numRe.test(t)).slice(0, 4);
    if (nums.length < 4) continue;
    const [paid, cost, margin, price] = nums.map((n) => n.replace(/,/g, ""));

    const date = lastDate;
    if (!date || !name) continue;
    out.push([date, name, phone, weight, pure, karat, paid, cost, margin, price]);
  }

  return out;
}

try {
  for (const p of imagePaths) {
    process.stderr.write(`\n\n--- OCR: ${p} ---\n`);
    const { data } = await worker.recognize(p);
    const text = (data?.text ?? "").trimEnd();
    const hocr = data?.hocr;
    const tsv = data?.tsv;
    const hocrText = hocr && String(hocr) !== "null" ? String(hocr) : null;
    const tsvText = tsv && String(tsv) !== "null" ? String(tsv) : null;

    // If HOCR/TSV aren't available in this environment, we still attempt a regex-based extraction.
    let ledger = [];
    if (hocrText) {
      const words = parseHocrWords(hocrText);
      const width = estimateWidth(words);
      const lines = groupByYLines(words);
      ledger = toLedgerRows(lines, width);
    }
    if (ledger.length === 0) {
      ledger = extractLedgerRowsFromText(text);
    }

    process.stdout.write(`\n\n===== ${path.basename(p)} (TSV) =====\n`);
    process.stdout.write(
      [
        "날짜",
        "고객명",
        "번호",
        "중량",
        "순금",
        "함량",
        "매입금액",
        "처리원가",
        "마진",
        "처리 시세",
      ].join("\t") + "\n",
    );
    if (ledger.length === 0) {
      process.stdout.write("(자동 표 추출 실패: RAW OCR만 제공합니다)\n");
    } else for (const row of ledger) process.stdout.write(row.join("\t") + "\n");

    process.stdout.write(`\n\n===== ${path.basename(p)} (RAW OCR) =====\n`);
    process.stdout.write(text);
    process.stdout.write("\n");
  }
} finally {
  await worker.terminate();
  process.stderr.write("\n");
}


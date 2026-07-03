import * as XLSX from "xlsx";

export const LABOR_CATEGORIES = ["\uBC18\uC9C0", "\uBAA9\uAC78\uC774", "\uD314\uCC0C", "\uADC0\uAC78\uC774"] as const;
export type LaborCategory = (typeof LABOR_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(LABOR_CATEGORIES as readonly string[]);

export type ParsedLaborFeeItem = {
  /** \uCE74\uD14C\uACE0\uB9AC. \uB2E8\uC21C \uC591\uC2DD\uC73C\uB85C \uC5C5\uB85C\uB4DC\uD55C \uACBD\uC6B0 \uBE48 \uBB38\uC790\uC5F4. */
  category: LaborCategory | "";
  productCode: string;
  laborFeeWon: number;
  weightG: number | null;
};

export type LaborFeeParseResult = {
  items: ParsedLaborFeeItem[];
  errors: string[];
  warnings: string[];
  /** \uC2DC\uD2B8 \uC774\uB984\uC740 \uD68C\uC0AC\uBA85\uC744 \uC758\uBBF8\uD560 \uC218 \uC788\uC5B4 \uD638\uCD9C\uC790\uC5D0\uAC8C \uB178\uCD9C. */
  sheetName: string;
};

function toCellText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function parseNumber(value: unknown): number | null {
  const s = toCellText(value).replace(/,/g, "").replace(/\s+/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * \uC5D1\uC140(\uCCAB \uC2DC\uD2B8)\uC5D0\uC11C \uACF5\uC784\uD45C\uB97C \uD30C\uC2F1\uD55C\uB2E4.
 * \uADF8\uC2E4(=\uAE08\uC2E4) \uC591\uC2DD\uC744 \uAE30\uC900\uC73C\uB85C \uB3D9\uC791:
 * - \uCCAB \uD589\uC5D0 \uCE74\uD14C\uACE0\uB9AC\uBA85(\uBC18\uC9C0/\uBAA9\uAC78\uC774/\uD314\uCC0C/\uADC0\uAC78\uC774) \uD5E4\uB354\uAC00 \uBD84\uD3EC
 * - \uB450\uBC88\uC9F8 \uD589\uC5D0 \uC11C\uBE0C\uD5E4\uB354(\uBAA8\uB378\uBC88\uD638/\uC218\uB7C9/\uACF5\uC784/\uC911\uB7C9) \u2014 \uAC01 \uCE74\uD14C\uACE0\uB9AC \uBE14\uB85D\uBCC4\uB85C \uC21C\uC11C\uAC00 \uB2E4\uB97C \uC218 \uC788\uC74C
 * - \uCE74\uD14C\uACE0\uB9AC \uBE14\uB85D = \uCCAB \uCE74\uD14C\uACE0\uB9AC \uD5E4\uB354\uAC00 \uC2DC\uC791\uB418\uB294 \uCE7C\uB7FC\uBD80\uD130, \uB2E4\uC74C \uCE74\uD14C\uACE0\uB9AC \uD5E4\uB354 \uC9C1\uC804\uAE4C\uC9C0
 */
export function parseLaborFeeWorkbook(
  buffer: ArrayBuffer | Uint8Array,
): LaborFeeParseResult {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const wb = XLSX.read(data, { type: "array" });
  const sheetName = wb.SheetNames[0] ?? "";
  const ws = sheetName ? wb.Sheets[sheetName] : null;
  if (!ws) {
    return {
      items: [],
      errors: ["\uC5D1\uC140\uC5D0\uC11C \uC2DC\uD2B8\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."],
      warnings: [],
      sheetName,
    };
  }

  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(
    ws,
    { header: 1, raw: false, defval: "" },
  );

  // \uCE74\uD14C\uACE0\uB9AC \uD5E4\uB354 \uD589 \uCC3E\uAE30 (\uCD5C\uB300 10\uD589 \uC548\uC5D0\uC11C). \uC5C6\uC73C\uBA74 \uB2E8\uC21C \uC591\uC2DD\uC73C\uB85C \uD30C\uC2F1.
  let catRow = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] ?? [];
    if (row.some((c) => CATEGORY_SET.has(toCellText(c)))) {
      catRow = i;
      break;
    }
  }
  if (catRow < 0) {
    return parseSimpleLaborSheet(rows, sheetName);
  }
  const subRow = catRow + 1;
  const subHdr = (rows[subRow] ?? []) as (string | number | null | undefined)[];
  const catHdr = (rows[catRow] ?? []) as (string | number | null | undefined)[];

  type Block = {
    category: LaborCategory;
    startCol: number;
    endCol: number;
    codeCol: number;
    laborCol: number;
    weightCol: number;
  };
  const blocks: Block[] = [];
  const allCols = Math.max(catHdr.length, subHdr.length);
  const starts: { category: LaborCategory; startCol: number }[] = [];
  for (let c = 0; c < allCols; c++) {
    const v = toCellText(catHdr[c]);
    if (CATEGORY_SET.has(v)) {
      starts.push({ category: v as LaborCategory, startCol: c });
    }
  }
  for (let i = 0; i < starts.length; i++) {
    const startCol = starts[i].startCol;
    const endCol = i + 1 < starts.length ? starts[i + 1].startCol : allCols;
    let codeCol = -1;
    let laborCol = -1;
    let weightCol = -1;
    for (let c = startCol; c < endCol; c++) {
      const t = toCellText(subHdr[c]);
      if (!t) continue;
      if (
        codeCol < 0 &&
        (t.includes("\uBAA8\uB378") || t.includes("\uBC88\uD638") || t.includes("\uCF54\uB4DC"))
      ) {
        codeCol = c;
      } else if (laborCol < 0 && t.includes("\uACF5\uC784")) {
        laborCol = c;
      } else if (weightCol < 0 && (t.includes("\uC911\uB7C9") || t.toLowerCase().includes("g"))) {
        weightCol = c;
      }
    }
    if (codeCol < 0 || laborCol < 0) continue;
    blocks.push({
      category: starts[i].category,
      startCol,
      endCol,
      codeCol,
      laborCol,
      weightCol,
    });
  }

  if (blocks.length === 0) {
    return {
      items: [],
      errors: [
        "\uAC01 \uCE74\uD14C\uACE0\uB9AC\uC5D0\uC11C '\uBAA8\uB378\uBC88\uD638'\uC640 '\uACF5\uC784' \uD5E4\uB354\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
      ],
      warnings: [],
      sheetName,
    };
  }

  const items: ParsedLaborFeeItem[] = [];
  const warnings: string[] = [];
  for (const blk of blocks) {
    let parsedInBlock = 0;
    for (let r = subRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const code = toCellText(row[blk.codeCol]);
      if (!code) continue;
      const labor = parseNumber(row[blk.laborCol]);
      if (labor == null || labor < 0) {
        warnings.push(
          `${blk.category} ${r + 1}\uD589 "${code}": \uACF5\uC784 \uAC12\uC744 \uC77D\uC744 \uC218 \uC5C6\uC5B4 \uAC74\uB108\uB700`,
        );
        continue;
      }
      const weight =
        blk.weightCol >= 0 ? parseNumber(row[blk.weightCol]) : null;
      items.push({
        category: blk.category,
        productCode: code,
        laborFeeWon: Math.round(labor),
        weightG: weight != null && Number.isFinite(weight) ? weight : null,
      });
      parsedInBlock += 1;
    }
    if (parsedInBlock === 0) {
      warnings.push(`${blk.category} \uCE74\uD14C\uACE0\uB9AC\uC5D0\uC11C \uC720\uD6A8\uD55C \uD589\uC744 \uCC3E\uC9C0 \uBABB\uD568`);
    }
  }

  return { items, errors: [], warnings, sheetName };
}

/**
 * \uCE74\uD14C\uACE0\uB9AC \uD5E4\uB354\uAC00 \uC5C6\uB294 \uB2E8\uC21C \uC591\uC2DD\uC744 \uD30C\uC2F1\uD55C\uB2E4.
 * - \uCCAB \uD5E4\uB354 \uD589\uC5D0 "\uC81C\uD488\uBA85/\uBAA8\uB378\uBC88\uD638/\uCF54\uB4DC/\uBC88\uD638/\uD488\uBAA9" + "\uACF5\uC784" \uCEEC\uB7FC\uC774 \uC788\uC5B4\uC57C \uD568.
 * - "\uC911\uB7C9/g" \uCEEC\uB7FC\uC740 \uC120\uD0DD. \uC5C6\uC73C\uBA74 weightG = null.
 * - \uCE74\uD14C\uACE0\uB9AC\uB294 \uBE48 \uBB38\uC790\uC5F4("")\uB85C \uC800\uC7A5\uB41C\uB2E4.
 */
function parseSimpleLaborSheet(
  rows: (string | number | null | undefined)[][],
  sheetName: string,
): LaborFeeParseResult {
  const NAME_KEYWORDS = ["\uC81C\uD488\uBA85", "\uBAA8\uB378", "\uCF54\uB4DC", "\uBC88\uD638", "\uD488\uBAA9", "\uC81C\uD488"];
  const LABOR_KEYWORDS = ["\uACF5\uC784"];
  const WEIGHT_KEYWORDS = ["\uC911\uB7C9", "\uADF8\uB7A8", "(g)"];

  let headerRow = -1;
  let codeCol = -1;
  let laborCol = -1;
  let weightCol = -1;

  const scanRows = Math.min(rows.length, 20);
  for (let i = 0; i < scanRows; i++) {
    const row = rows[i] ?? [];
    let cc = -1;
    let lc = -1;
    let wc = -1;
    for (let c = 0; c < row.length; c++) {
      const t = toCellText(row[c]);
      if (!t) continue;
      const tLow = t.toLowerCase();
      if (cc < 0 && NAME_KEYWORDS.some((k) => t.includes(k))) {
        cc = c;
        continue;
      }
      if (lc < 0 && LABOR_KEYWORDS.some((k) => t.includes(k))) {
        lc = c;
        continue;
      }
      if (
        wc < 0 &&
        (WEIGHT_KEYWORDS.some((k) => t.includes(k)) || tLow === "g")
      ) {
        wc = c;
        continue;
      }
    }
    if (cc >= 0 && lc >= 0) {
      headerRow = i;
      codeCol = cc;
      laborCol = lc;
      weightCol = wc;
      break;
    }
  }

  if (headerRow < 0) {
    return {
      items: [],
      errors: [
        "\uD5E4\uB354 \uD589\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uCCAB \uD589\uC5D0 '\uC81C\uD488\uBA85'(\ub610\ub294 \uBAA8\ub378\uBC88\ud638)\uACFC '\uACF5\uC784' \uCEEC\uB7FC\uC774 \uC788\uB294\uC9C0 \uD655\uC778\uD558\uC138\uC694.",
      ],
      warnings: [],
      sheetName,
    };
  }

  const items: ParsedLaborFeeItem[] = [];
  const warnings: string[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const code = toCellText(row[codeCol]);
    if (!code) continue;
    const labor = parseNumber(row[laborCol]);
    if (labor == null || labor < 0) {
      warnings.push(
        `${r + 1}\uD589 "${code}": \uACF5\uC784 \uAC12\uC744 \uC77D\uC744 \uC218 \uC5C6\uC5B4 \uAC74\uB108\uB700`,
      );
      continue;
    }
    const weight = weightCol >= 0 ? parseNumber(row[weightCol]) : null;
    items.push({
      category: "",
      productCode: code,
      laborFeeWon: Math.round(labor),
      weightG: weight != null && Number.isFinite(weight) ? weight : null,
    });
  }

  return { items, errors: [], warnings, sheetName };
}
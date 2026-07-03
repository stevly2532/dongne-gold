"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { formatKRW } from "@/lib/format";

export type LedgerClipboardCopyOptions = {
  /** 복사 시 맨 윗줄에 붙일 헤더(표의 데이터 열 순서와 같아야 함. 삭제 버튼 등 `omitTrailingDataColumns` 앞까지만) */
  columnHeaders?: readonly string[];
  /**
   * 여러 칸 복사 시 `columnHeaders`로 맨 윗줄(열 이름)을 넣을지.
   * 기본 true. false면 값 행만 탭으로 붙는다.
   */
  includeHeaderRow?: boolean;
  /** 각 행 앞에서 복사하지 않을 칸 수(날짜·고객명 등 식별 열 제외) */
  omitLeadingDataColumns?: number;
  /** 각 행 끝에서 복사하지 않을 칸 수(예: 삭제 버튼 열이면 1) */
  omitTrailingDataColumns?: number;
};

type Props = {
  rootRef: RefObject<HTMLElement | null>;
  /** 설정 시 Ctrl/⌘+C로 선택 영역을 탭 구분 값으로 복사해 엑셀에 붙여넣을 수 있음 */
  clipboardCopy?: LedgerClipboardCopyOptions | null;
  /**
   * 열 번호(0부터) 헤더 클릭 시, 표에 보이는 행의 해당 열 합산 칸을 한 번에 선택.
   * (예: 매입내역 돈수 열 = 6)
   */
  headerClickSumColumns?: number[];
};

const TABLE_CLASS = "ledger-cell-select";
const SELECTED_CLASS = "ledger-cell-selected";
const DRAG_THRESHOLD_PX = 4;

type SumState = {
  cellCount: number;
  wonSum: number;
  wonCount: number;
  gSum: number;
  gCount: number;
  /** 순금 등 표시 돈수(중량÷3.75×함량계수 등) 합 */
  donSum: number;
  donCount: number;
  /** 단일 칸 선택 시 data-ledger-preview-* 로 하단에 크게 표시 */
  preview: { label: string; value: string } | null;
};

function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return Boolean(
    el.closest("button,a,input,textarea,select,label,[role='button']"),
  );
}

function getLedgerTable(root: HTMLElement): HTMLTableElement | null {
  return root.querySelector(`table.${TABLE_CLASS}`);
}

function dataRows(tbody: HTMLTableSectionElement): HTMLTableRowElement[] {
  return [...tbody.querySelectorAll<HTMLTableRowElement>("tr[data-ledger-row]")];
}

function parseCellKey(key: string): { rowId: string; col: number } | null {
  const i = key.lastIndexOf(":");
  if (i <= 0) return null;
  const rowId = key.slice(0, i);
  const col = Number(key.slice(i + 1));
  if (!Number.isFinite(col) || col < 0) return null;
  return { rowId, col };
}

function cellKey(rowId: string, col: number): string {
  return `${rowId}:${col}`;
}

function rectCellKeys(
  rows: HTMLTableRowElement[],
  rowIdxA: number,
  colA: number,
  rowIdxB: number,
  colB: number,
): Set<string> {
  const r0 = Math.min(rowIdxA, rowIdxB);
  const r1 = Math.max(rowIdxA, rowIdxB);
  const c0 = Math.min(colA, colB);
  const c1 = Math.max(colA, colB);
  const keys = new Set<string>();
  for (let r = r0; r <= r1; r++) {
    const tr = rows[r];
    const rowId = tr?.dataset.ledgerRow;
    if (!rowId) continue;
    for (let c = c0; c <= c1; c++) {
      const td = tr.cells[c];
      if (td) keys.add(cellKey(rowId, c));
    }
  }
  return keys;
}

function tdUnderPoint(
  root: HTMLElement,
  x: number,
  y: number,
): HTMLTableCellElement | null {
  const el = document.elementFromPoint(x, y);
  if (!el || !root.contains(el)) return null;
  const td = el.closest("td");
  if (!td || !root.contains(td)) return null;
  return td as HTMLTableCellElement;
}

function getRowColForTd(
  rows: HTMLTableRowElement[],
  td: HTMLTableCellElement,
): { rowIdx: number; col: number; rowId: string } | null {
  const tr = td.closest("tr");
  const rowId = tr?.dataset.ledgerRow;
  if (!rowId) return null;
  const rowIdx = rows.indexOf(tr as HTMLTableRowElement);
  if (rowIdx < 0) return null;
  return { rowIdx, col: td.cellIndex, rowId };
}

function clearSelectedVisual(table: HTMLTableElement) {
  table.querySelectorAll(`td.${SELECTED_CLASS}`).forEach((td) => {
    td.classList.remove(SELECTED_CLASS);
  });
}

function applySelectedVisual(table: HTMLTableElement, keys: Set<string>) {
  clearSelectedVisual(table);
  for (const key of keys) {
    const parsed = parseCellKey(key);
    if (!parsed) continue;
    const tr = table.querySelector<HTMLTableRowElement>(
      `tbody tr[data-ledger-row="${parsed.rowId}"]`,
    );
    if (!tr) continue;
    const td = tr.cells[parsed.col];
    if (td) td.classList.add(SELECTED_CLASS);
  }
}

/** 엑셀 붙여넣기용: 원화 기호(₩ 등) 없이 천 단위 구분만. */
function wonPlainTextForClipboardFromAttr(raw: string | null): string | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n).toLocaleString("ko-KR");
}

function cellPlainText(td: HTMLTableCellElement): string {
  if (td.hasAttribute("data-clipboard-text")) {
    return td.getAttribute("data-clipboard-text") ?? "";
  }
  const ledgerCopyWon = wonPlainTextForClipboardFromAttr(
    td.getAttribute("data-ledger-copy-won"),
  );
  if (ledgerCopyWon != null) return ledgerCopyWon;
  const sumWonPlain = wonPlainTextForClipboardFromAttr(
    td.getAttribute("data-sum-won"),
  );
  if (sumWonPlain != null) return sumWonPlain;
  const input = td.querySelector("input, textarea");
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
    return input.value.replace(/\s+/g, " ").trim();
  }
  const t = (td.textContent ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return t.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

function escapeTsvField(s: string): string {
  if (s.includes("\t") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function computeTotals(table: HTMLTableElement, keys: Set<string>): SumState {
  let wonSum = 0;
  let wonCount = 0;
  let gSum = 0;
  let gCount = 0;
  let donSum = 0;
  let donCount = 0;
  for (const key of keys) {
    const parsed = parseCellKey(key);
    if (!parsed) continue;
    const tr = table.querySelector(
      `tbody tr[data-ledger-row="${parsed.rowId}"]`,
    );
    if (!tr) continue;
    const td = (tr as HTMLTableRowElement).cells[parsed.col];
    if (!td) continue;
    const wAttr = td.getAttribute("data-sum-won");
    if (wAttr != null && wAttr.trim() !== "") {
      const n = Number(wAttr);
      if (Number.isFinite(n)) {
        wonSum += n;
        wonCount += 1;
      }
    }
    const gAttr = td.getAttribute("data-sum-g");
    if (gAttr != null && gAttr.trim() !== "") {
      const n = Number(gAttr);
      if (Number.isFinite(n)) {
        gSum += n;
        gCount += 1;
      }
    }
    const donAttr = td.getAttribute("data-sum-don");
    if (donAttr != null && donAttr.trim() !== "") {
      const n = Number(donAttr);
      if (Number.isFinite(n)) {
        donSum += n;
        donCount += 1;
      }
    }
  }
  return {
    cellCount: keys.size,
    wonSum,
    wonCount,
    gSum,
    gCount,
    donSum,
    donCount,
    preview: null,
  };
}

function cellPreviewForSelection(
  table: HTMLTableElement,
  keys: Set<string>,
): { label: string; value: string } | null {
  if (keys.size !== 1) return null;
  const key = keys.values().next().value;
  if (!key) return null;
  const parsed = parseCellKey(key);
  if (!parsed) return null;
  const tr = table.querySelector(
    `tbody tr[data-ledger-row="${parsed.rowId}"]`,
  );
  if (!tr) return null;
  const td = (tr as HTMLTableRowElement).cells[parsed.col];
  if (!td) return null;
  const label = td.getAttribute("data-ledger-preview-label")?.trim();
  const value = td.getAttribute("data-ledger-preview-value")?.trim();
  if (!label || !value) return null;
  return { label, value };
}

function computeSelectionState(
  table: HTMLTableElement,
  keys: Set<string>,
): SumState {
  const totals = computeTotals(table, keys);
  return {
    ...totals,
    preview: cellPreviewForSelection(table, keys),
  };
}

function formatGramSum(n: number): string {
  const t = (Math.round(n * 1e6) / 1e6).toString();
  if (t.includes(".")) return t.replace(/\.?0+$/, "");
  return t;
}

/** 장부 순금(돈) 합: 소수 둘째 자리까지 반올림 후 불필요한 0 제거 */
function formatDonSum(n: number): string {
  const t = (Math.round(n * 100) / 100).toString();
  if (t.includes(".")) return t.replace(/\.?0+$/, "");
  return t;
}

/**
 * Excel-like cell selection inside a table.ledger-cell-select:
 * drag rectangle, Ctrl/Cmd+click toggles a cell, Ctrl/Cmd+drag adds a rectangle.
 * Sums td[data-sum-won], td[data-sum-g], td[data-sum-don] among selected cells.
 */
function columnHasSumAttribute(td: HTMLTableCellElement): boolean {
  return (
    td.hasAttribute("data-sum-won") ||
    td.hasAttribute("data-sum-g") ||
    td.hasAttribute("data-sum-don")
  );
}

export function LedgerSelectionSumBar({
  rootRef,
  clipboardCopy = null,
  headerClickSumColumns,
}: Props) {
  const [sumState, setSumState] = useState<SumState | null>(null);
  const selectedRef = useRef<Set<string>>(new Set());
  const draggingRef = useRef(false);
  const anchorRef = useRef<{ rowIdx: number; col: number; rowId: string } | null>(
    null,
  );
  const ctrlRef = useRef(false);
  const baseSelectionRef = useRef<Set<string>>(new Set());
  const didDragRef = useRef(false);
  const startXYRef = useRef({ x: 0, y: 0 });
  const [copyFlash, setCopyFlash] = useState(false);

  const syncFromKeys = useCallback((root: HTMLElement, keys: Set<string>) => {
    const table = getLedgerTable(root);
    if (!table) return;
    selectedRef.current = keys;
    applySelectedVisual(table, keys);
    setSumState(keys.size > 0 ? computeSelectionState(table, keys) : null);
  }, []);

  const clearAll = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      selectedRef.current = new Set();
      setSumState(null);
      return;
    }
    const table = getLedgerTable(root);
    if (table) clearSelectedVisual(table);
    selectedRef.current = new Set();
    setSumState(null);
  }, [rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onRootMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const targetEl =
        e.target instanceof Element
          ? e.target
          : (e.target as Node).parentElement;
      if (!targetEl) return;
      if (isInteractiveTarget(targetEl)) return;

      const td = targetEl.closest("td");
      if (!td || !root.contains(td)) return;

      const table = getLedgerTable(root);
      if (!table || !table.contains(td)) return;

      const tbody = table.tBodies[0];
      if (!tbody) return;

      const rows = dataRows(tbody);
      const pos = getRowColForTd(rows, td as HTMLTableCellElement);
      if (!pos) return;

      e.preventDefault();

      const ctrl = e.ctrlKey || e.metaKey;
      ctrlRef.current = ctrl;
      anchorRef.current = pos;
      draggingRef.current = true;
      didDragRef.current = false;
      startXYRef.current = { x: e.clientX, y: e.clientY };

      if (ctrl) {
        baseSelectionRef.current = new Set(selectedRef.current);
      } else {
        baseSelectionRef.current = new Set();
        const single = new Set([cellKey(pos.rowId, pos.col)]);
        syncFromKeys(root, single);
      }

      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current || !anchorRef.current) return;
        const dx = ev.clientX - startXYRef.current.x;
        const dy = ev.clientY - startXYRef.current.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          didDragRef.current = true;
        }

        const tbodyEl = table.tBodies[0];
        if (!tbodyEl) return;
        const rowList = dataRows(tbodyEl);
        const a = anchorRef.current;

        const endTd = tdUnderPoint(root, ev.clientX, ev.clientY);
        const endPos =
          endTd != null ? (getRowColForTd(rowList, endTd) ?? a) : a;

        const rect = rectCellKeys(
          rowList,
          a.rowIdx,
          a.col,
          endPos.rowIdx,
          endPos.col,
        );

        let next: Set<string>;
        if (ctrlRef.current) {
          if (!didDragRef.current) return;
          next = new Set(baseSelectionRef.current);
          rect.forEach((k) => next.add(k));
        } else {
          if (!didDragRef.current) {
            next = new Set([cellKey(a.rowId, a.col)]);
          } else {
            next = rect;
          }
        }

        syncFromKeys(root, next);
      };

      const onUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);

        if (!anchorRef.current) return;
        const a = anchorRef.current;
        const anchorKey = cellKey(a.rowId, a.col);

        if (ctrlRef.current) {
          if (!didDragRef.current) {
            const next = new Set(baseSelectionRef.current);
            if (next.has(anchorKey)) next.delete(anchorKey);
            else next.add(anchorKey);
            syncFromKeys(root, next);
          }
        } else {
          syncFromKeys(root, selectedRef.current);
        }

        anchorRef.current = null;
      };

      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
    };

    const onDocMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (t instanceof Node && root.contains(t)) return;
      if (selectedRef.current.size > 0) clearAll();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedRef.current.size > 0) clearAll();
    };

    root.addEventListener("mousedown", onRootMouseDown);
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      root.removeEventListener("mousedown", onRootMouseDown);
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [rootRef, syncFromKeys, clearAll]);

  useEffect(() => {
    const cols = headerClickSumColumns;
    if (!cols?.length) return;
    const root = rootRef.current;
    if (!root) return;

    const colSet = new Set(cols);

    const onThClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const th = (e.target as Element).closest("th");
      if (!th || !root.contains(th)) return;
      const headerRow = th.closest("tr");
      if (!headerRow?.parentElement || headerRow.parentElement.tagName !== "THEAD") {
        return;
      }
      const col = (th as HTMLTableCellElement).cellIndex;
      if (!colSet.has(col)) return;

      e.preventDefault();
      e.stopPropagation();

      const table = getLedgerTable(root);
      if (!table) return;
      const tbody = table.tBodies[0];
      if (!tbody) return;

      const keys = new Set<string>();
      for (const row of dataRows(tbody)) {
        const rowId = row.dataset.ledgerRow;
        if (!rowId) continue;
        const td = row.cells[col];
        if (!td || !columnHasSumAttribute(td)) continue;
        keys.add(cellKey(rowId, col));
      }
      syncFromKeys(root, keys);
    };

    root.addEventListener("click", onThClick);
    return () => root.removeEventListener("click", onThClick);
  }, [headerClickSumColumns, rootRef, syncFromKeys]);

  useEffect(() => {
    if (!clipboardCopy) return;
    const root = rootRef.current;
    if (!root) return;

    const omit = Math.max(0, clipboardCopy.omitTrailingDataColumns ?? 0);
    const lead = Math.max(0, clipboardCopy.omitLeadingDataColumns ?? 0);
    const headers = clipboardCopy.columnHeaders;
    const includeHeaderRow = clipboardCopy.includeHeaderRow !== false;

    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== "c" && e.key !== "C") return;
      if (!e.ctrlKey && !e.metaKey) return;
      if (selectedRef.current.size === 0) return;

      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ) {
        return;
      }

      const table = getLedgerTable(root);
      if (!table) return;
      const tbody = table.tBodies[0];
      if (!tbody) return;
      const rowList = dataRows(tbody);
      if (rowList.length === 0) return;

      const nCells = rowList[0].cells.length;
      const lastCopyableCol = nCells - 1 - omit;
      const firstCopyableCol = lead;
      if (lastCopyableCol < 0 || firstCopyableCol > lastCopyableCol) return;

      let rMin = Infinity;
      let rMax = -Infinity;
      let cMin = Infinity;
      let cMax = -Infinity;
      for (const key of selectedRef.current) {
        const parsed = parseCellKey(key);
        if (!parsed) continue;
        const rowIdx = rowList.findIndex(
          (tr) => tr.dataset.ledgerRow === parsed.rowId,
        );
        if (rowIdx < 0) continue;
        rMin = Math.min(rMin, rowIdx);
        rMax = Math.max(rMax, rowIdx);
        cMin = Math.min(cMin, parsed.col);
        cMax = Math.max(cMax, parsed.col);
      }
      if (!Number.isFinite(rMin) || rMin < 0) return;

      const effC0 = Math.max(
        firstCopyableCol,
        Math.min(cMin, lastCopyableCol),
      );
      const effC1 = Math.max(effC0, Math.min(cMax, lastCopyableCol));

      const lines: string[][] = [];
      const isSingleCell =
        selectedRef.current.size === 1 && rMin === rMax && effC0 === effC1;
      if (
        includeHeaderRow &&
        !isSingleCell &&
        headers != null &&
        headers.length > effC0
      ) {
        const head: string[] = [];
        for (let c = effC0; c <= effC1; c++) {
          head.push(headers[c] ?? "");
        }
        lines.push(head);
      }

      for (let r = rMin; r <= rMax; r++) {
        const tr = rowList[r];
        const rowId = tr.dataset.ledgerRow;
        if (!rowId) continue;
        const cells: string[] = [];
        for (let c = effC0; c <= effC1; c++) {
          const k = cellKey(rowId, c);
          if (!selectedRef.current.has(k)) {
            cells.push("");
            continue;
          }
          const td = tr.cells[c];
          cells.push(td ? cellPlainText(td as HTMLTableCellElement) : "");
        }
        lines.push(cells);
      }

      const tsv = lines
        .map((row) => row.map(escapeTsvField).join("\t"))
        .join("\n");

      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard.writeText(tsv).then(() => {
        setCopyFlash(true);
        window.setTimeout(() => setCopyFlash(false), 1200);
      });
    };

    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => document.removeEventListener("keydown", onKeyDownCapture, true);
  }, [clipboardCopy, rootRef]);

  if (!sumState || sumState.cellCount === 0) return null;

  const hasNumeric =
    sumState.wonCount > 0 || sumState.gCount > 0 || sumState.donCount > 0;
  const hasPreview = sumState.preview != null;
  const previewOnly = hasPreview && !hasNumeric;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] max-w-[min(100vw-1rem,28rem)] -translate-x-1/2 px-2"
      aria-live="polite"
    >
      <div className="rounded-lg bg-[var(--card)]/95 px-3 py-2 text-center shadow-lg backdrop-blur-sm ring-1 ring-[var(--border)]">
        {previewOnly ? (
          <div className="text-sm font-semibold leading-snug text-[var(--foreground)]">
            {sumState.preview!.label}{" "}
            <span className="break-words">{sumState.preview!.value}</span>
          </div>
        ) : (
          <>
            <div className="text-[11px] font-medium text-[var(--foreground)]">
              선택 {sumState.cellCount}칸
              {!hasNumeric ? (
                <span className="ml-1 font-normal text-[var(--muted)]">
                  · 금액/중량/순금(돈) 합산 가능한 칸 없음
                </span>
              ) : null}
              {clipboardCopy ? (
                <span className="mt-0.5 block font-normal text-[var(--muted)]">
                  {copyFlash ? (
                    <span className="text-positive font-semibold">
                      복사했습니다 · 엑셀에 붙여넣기
                    </span>
                  ) : (
                    <>Ctrl+C(⌘+C)로 엑셀에 붙여넣기</>
                  )}
                </span>
              ) : null}
            </div>
            {hasPreview ? (
              <div className="mt-1 text-sm font-semibold leading-snug text-[var(--foreground)]">
                {sumState.preview!.label}{" "}
                <span className="break-words">{sumState.preview!.value}</span>
              </div>
            ) : null}
            {hasNumeric ? (
              <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-sm font-semibold tabular-nums text-[var(--foreground)]">
                {sumState.wonCount > 0 ? (
                  <span>
                    금액 {formatKRW(sumState.wonSum)}
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      ({sumState.wonCount})
                    </span>
                  </span>
                ) : null}
                {sumState.wonCount > 0 &&
                (sumState.gCount > 0 || sumState.donCount > 0) ? (
                  <span className="text-[var(--muted)]">·</span>
                ) : null}
                {sumState.gCount > 0 ? (
                  <span>
                    중량 {formatGramSum(sumState.gSum)}g
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      ({sumState.gCount})
                    </span>
                  </span>
                ) : null}
                {sumState.gCount > 0 && sumState.donCount > 0 ? (
                  <span className="text-[var(--muted)]">·</span>
                ) : null}
                {sumState.donCount > 0 ? (
                  <span>
                    순금 {formatDonSum(sumState.donSum)}돈
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      ({sumState.donCount})
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

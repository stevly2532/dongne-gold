"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryItem } from "@/types/db";

/** 되돌리기(Undo)에 쓰는 inventory_items 스냅샷 */
export type InventoryUndoSnapshot = {
  received?: boolean;
  received_note?: string | null;
  shipped?: boolean;
  shipped_note?: string | null;
  receivable_won?: number | null;
  arrival_sms_sent_at?: string | null;
  labor_fee?: number | null;
  jongro_quote_override_per_don?: number | null;
};

type UndoEntry = {
  rowId: string;
  /** 방금 한 작업 설명 (토스트용) */
  actionLabel: string;
  before: InventoryUndoSnapshot;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

function snapInOutRow(row: InventoryItem): InventoryUndoSnapshot {
  return {
    received: Boolean(row.received),
    received_note: row.received_note ?? null,
    shipped: Boolean(row.shipped),
    shipped_note: row.shipped_note ?? null,
    receivable_won: row.receivable_won ?? null,
    arrival_sms_sent_at: row.arrival_sms_sent_at ?? null,
  };
}

export function describeInOutAction(
  field: "received" | "shipped",
  trimmed: string,
  hadReceivableClear?: boolean,
): string {
  if (field === "shipped") {
    if (trimmed.length > 0) {
      return hadReceivableClear ? "미수 완불 + 출고 완료" : "출고 완료";
    }
    return "출고 취소";
  }
  if (trimmed.length > 0) return "입고 완료";
  return "입고 취소";
}

/**
 * 월매출장부 등 inventory_items 인라인 수정용 Undo 스택.
 * Ctrl+Z(⌘+Z) — 입력칸에 포커스가 있을 때는 브라우저 기본 동작 유지.
 */
export function useInventoryLedgerUndo(
  supabase: SupabaseClient,
  setRows: React.Dispatch<React.SetStateAction<InventoryItem[]>>,
  setError: (msg: string | null) => void,
  onUndoApplied?: (message: string) => void,
  maxDepth = 30,
) {
  const stackRef = useRef<UndoEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const syncCanUndo = useCallback(() => {
    setCanUndo(stackRef.current.length > 0);
  }, []);

  const pushUndo = useCallback(
    (entry: UndoEntry) => {
      stackRef.current.push(entry);
      if (stackRef.current.length > maxDepth) {
        stackRef.current.shift();
      }
      syncCanUndo();
    },
    [maxDepth, syncCanUndo],
  );

  const pushInOutUndo = useCallback(
    (
      row: InventoryItem,
      field: "received" | "shipped",
      trimmed: string,
      hadReceivableClear?: boolean,
    ) => {
      pushUndo({
        rowId: row.id,
        actionLabel: describeInOutAction(field, trimmed, hadReceivableClear),
        before: snapInOutRow(row),
      });
    },
    [pushUndo],
  );

  const undoLast = useCallback(async () => {
    const entry = stackRef.current.pop();
    syncCanUndo();
    if (!entry) return false;

    const updatedAt = new Date().toISOString();
    const payload = { ...entry.before, updated_at: updatedAt };
    const { error: ue } = await supabase
      .from("inventory_items")
      .update(payload)
      .eq("id", entry.rowId);

    if (ue) {
      stackRef.current.push(entry);
      syncCanUndo();
      setError(ue.message);
      return false;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.id === entry.rowId ? { ...r, ...payload, updated_at: updatedAt } : r,
      ),
    );
    setError(null);
    onUndoApplied?.(`↩ ${entry.actionLabel} 되돌림`);
    return true;
  }, [supabase, setRows, setError, onUndoApplied, syncCanUndo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      if (e.shiftKey) return;
      if (isEditableTarget(e.target)) return;
      if (stackRef.current.length === 0) return;
      e.preventDefault();
      void undoLast();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoLast]);

  return { pushUndo, pushInOutUndo, undoLast, canUndo, snapInOutRow };
}

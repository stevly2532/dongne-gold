import { useCallback, useRef } from "react";

export function useEnterAdvance(order: string[]) {
  const refs = useRef<Record<string, HTMLElement | null>>({});

  const reg = useCallback((id: string) => {
    return (el: HTMLElement | null) => {
      refs.current[id] = el;
    };
  }, []);

  const onKeyDown = useCallback(
    (id: string) => (e: React.KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const idx = order.indexOf(id);
      if (idx < 0) return;
      const nextId = order[idx + 1];
      if (nextId) {
        refs.current[nextId]?.focus();
      }
    },
    [order],
  );

  return { reg, onKeyDown };
}

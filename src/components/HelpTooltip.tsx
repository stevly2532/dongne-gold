"use client";

import type { ReactNode } from "react";

type HelpTooltipProps = {
  children: ReactNode;
  label?: string;
  className?: string;
  /** icon=?, text=▶ 도움말 (매입시세 블록 등) */
  trigger?: "icon" | "text";
};

/** 작은 ? 또는 ▶ 도움말 — hover·focus 시 도움말 툴팁 */
export function HelpTooltip({
  children,
  label = "도움말",
  className,
  trigger = "icon",
}: HelpTooltipProps) {
  return (
    <span
      className={`group/help relative inline-flex shrink-0 align-middle ${className ?? ""}`}
    >
      <button
        type="button"
        tabIndex={0}
        className={
          trigger === "text"
            ? "inline-flex items-center gap-0.5 text-xs font-normal text-[var(--muted)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30"
            : "inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[10px] font-semibold leading-none text-[var(--muted)] transition-colors hover:border-amber-400 hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 dark:hover:text-amber-200"
        }
        aria-label={label}
      >
        {trigger === "text" ? (
          <>
            <span aria-hidden className="text-[10px] leading-none">
              ▶
            </span>
            도움말
          </>
        ) : (
          "?"
        )}
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-[calc(100%+6px)] z-50 w-max max-w-[min(18rem,calc(100vw-2rem))] whitespace-normal rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-2 text-[11px] font-normal leading-snug text-[var(--foreground)] opacity-0 shadow-lg transition-opacity duration-150 group-hover/help:opacity-100 group-focus-within/help:opacity-100 ${
          trigger === "text"
            ? "left-0"
            : "left-1/2 -translate-x-1/2"
        }`}
      >
        {children}
      </span>
    </span>
  );
}

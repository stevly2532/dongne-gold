"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TITLE = "\uB9E4\uC785\uC7A5\uBD80";

const INTRO_BEFORE =
  "\uAE08\u00B7\uC740\u00B7\uCE58\uAE08 \uB9E4\uC785 \uB0B4\uC5ED\uC744 \uD0ED\uC5D0\uC11C \uC804\uD658\uD574 \uC870\uD68C\uD569\uB2C8\uB2E4. \uB4F1\uB85D\uC740 ";

const INTRO_HIGHLIGHT = "\uB9E4\uC785\uB4F1\uB85D";

const INTRO_AFTER =
  "\uC5D0\uC11C \uD488\uBAA9\uC744 \uC120\uD0DD\uD574 \uC785\uB825\uD569\uB2C8\uB2E4.";

const TABS: { href: string; label: string }[] = [
  { href: "/monthly-ledger", label: "\uAE08\uB9E4\uC785" },
  { href: "/silver-ledger", label: "\uC740\uB9E4\uC785" },
  { href: "/chigum-ledger", label: "\uCE58\uAE08\uB9E4\uC785" },
  { href: "/platinum-ledger", label: "\uBC31\uAE08\uB9E4\uC785" },
];

const NAV_LABEL = "\uB9E4\uC785 \uC7A5\uBD80 \uC885\uB958";

type Props = {
  children?: ReactNode;
  /** 금매입 등 토스 핀테크 2열 카드 레이아웃 */
  variant?: "default" | "fintech";
};

export function PurchaseLedgersChrome({
  children,
  variant = "default",
}: Props) {
  const pathname = usePathname();

  const tabNav = (
    <nav
      className={
        variant === "fintech"
          ? "purchase-ledger-tab-group shrink-0"
          : "toss-card-sm flex flex-wrap items-center gap-1 p-1"
      }
      aria-label={NAV_LABEL}
    >
      {TABS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={
              variant === "fintech"
                ? active
                  ? "purchase-ledger-tab purchase-ledger-tab-active"
                  : "purchase-ledger-tab purchase-ledger-tab-inactive"
                : active
                  ? "toss-nav-link-active"
                  : "toss-nav-link"
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );

  if (variant === "fintech") {
    return (
      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="purchase-ledger-header-title">{TITLE}</h1>
            <p className="purchase-ledger-header-desc">
              {INTRO_BEFORE}
              <span className="font-semibold text-[#191f28] dark:text-[var(--foreground)]">
                {INTRO_HIGHLIGHT}
              </span>
              {INTRO_AFTER}
            </p>
          </div>
          {tabNav}
        </div>
        {children ? <div className="mt-5">{children}</div> : null}
      </header>
    );
  }

  return (
    <header className="mb-6">
      <div className="purchase-ledger-work-card p-4 sm:p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--foreground)]">{TITLE}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              {INTRO_BEFORE}
              <span className="font-semibold text-[var(--foreground)]">
                {INTRO_HIGHLIGHT}
              </span>
              {INTRO_AFTER}
            </p>
          </div>
          {tabNav}
        </div>
        {children ? (
          <div className="mt-5 border-t border-[var(--border)] pt-5">{children}</div>
        ) : null}
      </div>
    </header>
  );
}

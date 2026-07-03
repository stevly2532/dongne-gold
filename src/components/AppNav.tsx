"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SOLO_SHOP_MODE } from "@/config/app";
import { NavGoldTicker } from "@/components/NavGoldTicker";
import { ThemeToggle } from "@/components/ThemeToggle";

type Props = {
  email: string | null;
  isAdmin?: boolean;
};

const linkClass = (active: boolean) =>
  active ? "toss-nav-link-active" : "toss-nav-link";

export function AppNav({ email, isAdmin = false }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="toss-nav sticky top-0 z-40">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5 lg:px-6">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <span className="mr-2 text-sm font-bold text-[var(--foreground)]">
            동네금빵
          </span>
          <Link href="/purchases" className={linkClass(pathname === "/purchases")}>
            매입등록
          </Link>
          <Link href="/inventory" className={linkClass(pathname === "/inventory")}>
            매출등록
          </Link>
          <Link
            href="/labor-fees"
            className={linkClass(pathname === "/labor-fees")}
          >
            공임
          </Link>
          <Link href="/as-ledger" className={linkClass(pathname === "/as-ledger")}>
            AS 장부
          </Link>
          <Link
            href="/daily-closing"
            className={linkClass(pathname === "/daily-closing")}
          >
            일일마감
          </Link>
          <Link
            href="/tongsang"
            className={linkClass(pathname === "/tongsang")}
          >
            통상
          </Link>
          <Link
            href="/premium-calc"
            className={linkClass(pathname === "/premium-calc")}
          >
            프리미엄
          </Link>
          {isAdmin ? (
            <Link
              href="/monthly-ledger"
              className={linkClass(
                pathname === "/monthly-ledger" ||
                  pathname === "/silver-ledger" ||
                  pathname === "/chigum-ledger" ||
                  pathname === "/platinum-ledger",
              )}
            >
              매입장부
            </Link>
          ) : null}
          {isAdmin ? (
            <Link
              href="/sales-ledger"
              className={linkClass(pathname === "/sales-ledger")}
            >
              매출장부
            </Link>
          ) : null}
          {!SOLO_SHOP_MODE && isAdmin ? (
            <>
              <Link href="/branches" className={linkClass(pathname === "/branches")}>
                지점
              </Link>
              <Link href="/staff" className={linkClass(pathname === "/staff")}>
                직원
              </Link>
            </>
          ) : null}
        </div>
        <NavGoldTicker />
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <span className="hidden text-xs text-[var(--muted)] sm:inline">{email}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="toss-btn-secondary px-3 py-1.5 text-sm"
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}

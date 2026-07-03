"use client";

import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/ThemeToggle";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/purchases";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    const supabase = createClient();

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push(nextPath);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "로그인에 실패했습니다.";
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell flex min-h-full flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="purchase-ledger-work-card w-full max-w-md p-8 sm:p-10">
        <div className="flex flex-col items-center">
          <Image
            src="/brand/dongne-geumbbang-logo.png"
            alt="동네금빵"
            width={560}
            height={320}
            priority
            className="h-auto w-full max-w-[260px] object-contain"
          />
          <p className="mt-5 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
            로그인
          </p>
        </div>
        <h1 className="sr-only">동네금빵 로그인</h1>

        <form className="mt-6 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)]">
              이메일
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              className="toss-input mt-1.5 w-full px-3 py-2.5 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)]">
              비밀번호
            </label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="current-password"
              className="toss-input mt-1.5 w-full px-3 py-2.5 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {message ? (
            <p className="toss-alert-error rounded-2xl px-3 py-2 text-sm">
              {message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="toss-btn-primary w-full py-3 text-sm"
          >
            {loading ? "잠시만요…" : "로그인"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--muted)]">
          <Link href="/" className="underline hover:text-[var(--foreground)]">
            처음으로
          </Link>
        </p>
      </div>
    </div>
  );
}

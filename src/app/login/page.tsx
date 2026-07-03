import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div
          className="app-shell flex min-h-full flex-1 items-center justify-center text-[var(--muted)]"
        >
          불러오는 중…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
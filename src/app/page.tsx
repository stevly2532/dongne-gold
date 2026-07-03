import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/purchases");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-stone-100 px-6 py-16">
      <div className="max-w-lg text-center">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)] sm:text-4xl">
          동네금빵
        </h1>
        <p className="mt-4 text-left text-sm text-[var(--muted)] leading-relaxed">
          금매입 장부와 재고·예상 마진을 한곳에서 봅니다. 데이터는 Supabase에
          저장됩니다. 지금은 사장님 한 분만 쓰는 화면으로 단순하게
          만들었습니다.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="toss-btn-primary inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm shadow"
          >
            로그인
          </Link>
        </div>
        <p className="mt-10 text-left text-xs text-[var(--muted)] leading-relaxed">
          1) 로컬: <code className="rounded bg-stone-200 px-1">.env.example</code>을
          참고해 <code className="rounded bg-stone-200 px-1">.env.local</code> 작성
          (배포는 Vercel Environment Variables에 동일 이름으로 등록)
          <br />
          2) Supabase SQL에서{" "}
          <code className="rounded bg-stone-200 px-1">npm run db:bootstrap-new-shop</code>{" "}
          (또는 <code className="rounded bg-stone-200 px-1">docs/SETUP_NEW_SHOP.md</code> 참고)
          <br />
          3) Supabase → Authentication → Users에서 계정 추가, 웹에서는 로그인만
          <br />
          4) Authentication → Providers → Email에서 &quot;새 사용자 가입 허용&quot;은
          끄는 것을 권장합니다.
        </p>
      </div>
    </div>
  );
}

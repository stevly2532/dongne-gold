import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/purchases",
  "/monthly-ledger",
  "/silver-ledger",
  "/chigum-ledger",
  "/platinum-ledger",
  "/sales-ledger",
  "/as-ledger",
  "/inventory",
  "/branches",
  "/staff",
];

/** 관리자만 접근. 직원은 매입등록·판매·일일마감 등만 사용. */
const ADMIN_ONLY_PREFIXES = [
  "/monthly-ledger",
  "/silver-ledger",
  "/chigum-ledger",
  "/platinum-ledger",
  "/sales-ledger",
  "/as-ledger",
  "/branches",
  "/staff",
];

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  if (needsAuth && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  if (user) {
    const adminOnly = ADMIN_ONLY_PREFIXES.some(
      (p) => path === p || path.startsWith(`${p}/`),
    );
    if (adminOnly) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (prof?.role !== "admin") {
        const fallback = request.nextUrl.clone();
        fallback.pathname = "/purchases";
        fallback.search = "";
        return NextResponse.redirect(fallback);
      }
    }
  }

  if (path === "/login" && user) {
    const appUrl = request.nextUrl.clone();
    appUrl.pathname = "/purchases";
    appUrl.searchParams.delete("next");
    return NextResponse.redirect(appUrl);
  }

  return supabaseResponse;
}
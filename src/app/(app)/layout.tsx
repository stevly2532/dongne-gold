import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/AppNav";
import { AppProviders } from "@/components/AppProviders";
import { DEFAULT_BRANCH, SHOP_OWNER_EMAILS } from "@/config/app";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const isOwner = SHOP_OWNER_EMAILS.some(
    (email) => email.toLowerCase() === user.email?.toLowerCase(),
  );

  const [profRes, brRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, branch_id")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("branches").select("id, name, created_at").order("name"),
  ]);

  const prof = profRes.data;
  let branches = (brRes.data ?? []) as {
    id: string;
    name: string;
    created_at: string;
  }[];

  if (!branches.length && isOwner) {
    branches = [
      {
        id: DEFAULT_BRANCH.id,
        name: DEFAULT_BRANCH.name,
        created_at: new Date(0).toISOString(),
      },
    ];
  }

  const role = (prof?.role ?? (isOwner ? "admin" : "staff")) as
    | "admin"
    | "staff";
  const branchId =
    prof?.branch_id ??
    (role === "admin" ? (branches[0]?.id ?? DEFAULT_BRANCH.id) : null);
  const isAdmin = role === "admin";

  return (
    <AppProviders
      bootstrap={{
        profile: {
          id: user.id,
          full_name: prof?.full_name ?? (isOwner ? "관리자" : null),
          role,
          branch_id: branchId,
        },
        branches,
      }}
    >
      <div className="app-shell flex min-h-full flex-1 flex-col">
        <AppNav email={user.email ?? null} isAdmin={isAdmin} />
        <div className="w-full flex-1 px-0 py-6 sm:py-8">{children}</div>
      </div>
    </AppProviders>
  );
}

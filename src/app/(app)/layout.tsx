import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/AppNav";
import { AppProviders } from "@/components/AppProviders";

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

  const [profRes, brRes] = await Promise.all([
    supabase
    .from("profiles")
      .select("id, full_name, role, branch_id")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("id, name, created_at")
      .order("name"),
  ]);

  const prof = profRes.data;
  const branches = (brRes.data ?? []) as { id: string; name: string; created_at: string }[];
  const isAdmin = prof?.role === "admin";

  return (
    <AppProviders
      bootstrap={{
        profile: {
          id: user.id,
          full_name: prof?.full_name ?? null,
          role: (prof?.role ?? "staff") as "admin" | "staff",
          branch_id: prof?.branch_id ?? null,
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
import { redirect } from "next/navigation";
import { getPracticeUser } from "@/lib/rbac";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pu = await getPracticeUser();
  if (!pu) redirect("/onboarding/create-practice");

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white px-6 py-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-900">{pu.practice.name}</span>
          <span className="text-sm text-slate-500">{pu.dbUser.email}</span>
        </div>
      </header>
      {children}
    </div>
  );
}

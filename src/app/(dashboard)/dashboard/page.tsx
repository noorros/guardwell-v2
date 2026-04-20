import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";

export default async function DashboardPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  const eventCount = await db.eventLog.count({
    where: { practiceId: pu.practiceId },
  });

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">
        Welcome to {pu.practice.name}
      </h1>
      <div className="rounded-xl bg-white p-6 shadow">
        <p className="text-sm text-slate-600">Practice ID: {pu.practiceId}</p>
        <p className="text-sm text-slate-600">Primary state: {pu.practice.primaryState}</p>
        <p className="text-sm text-slate-600">Your role: {pu.role}</p>
        <p className="mt-4 text-xs text-slate-400">
          Events recorded for this practice: {eventCount}
        </p>
      </div>
    </main>
  );
}

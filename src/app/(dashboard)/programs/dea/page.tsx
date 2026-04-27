// src/app/(dashboard)/programs/dea/page.tsx
import { redirect } from "next/navigation";
import type { Route } from "next";
import { Pill } from "lucide-react";
import { db } from "@/lib/db";
import { getPracticeUser } from "@/lib/rbac";
import { Breadcrumb } from "@/components/gw/Breadcrumb";
import { DeaDashboard } from "./DeaDashboard";

export const metadata = { title: "DEA · My Programs" };
export const dynamic = "force-dynamic";

export default async function DeaProgramPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;
  const framework = await db.practiceFramework.findFirst({
    where: {
      practiceId: pu.practiceId,
      enabled: true,
      framework: { code: "DEA" },
    },
  });
  if (!framework) {
    redirect("/dashboard" as Route);
  }
  // 20 most recent inventories with item counts. Phase B is inventory-only;
  // Orders / Disposals / Theft & Loss tabs ship in Phase C/D.
  const inventories = await db.deaInventory.findMany({
    where: { practiceId: pu.practiceId },
    orderBy: { asOfDate: "desc" },
    take: 20,
    include: {
      _count: { select: { items: true } },
    },
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumb items={[{ label: "My Programs" }, { label: "DEA" }]} />
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Pill className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            DEA Controlled Substances
          </h1>
          <p className="text-sm text-muted-foreground">
            Inventory snapshots, order receipts, disposals to reverse distributors, and theft/loss reports per 21 CFR Parts 1304 + 1311.
          </p>
        </div>
      </header>
      <DeaDashboard
        canManage={pu.role === "OWNER" || pu.role === "ADMIN"}
        currentUserId={pu.userId}
        inventories={inventories.map((i) => ({
          id: i.id,
          asOfDate: i.asOfDate.toISOString(),
          conductedByUserId: i.conductedByUserId,
          witnessUserId: i.witnessUserId,
          notes: i.notes,
          itemCount: i._count.items,
        }))}
      />
    </main>
  );
}

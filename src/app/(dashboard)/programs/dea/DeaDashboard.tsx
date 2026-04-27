"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryTab, type InventoryTabProps } from "./InventoryTab";

export interface DeaDashboardProps {
  canManage: boolean;
  currentUserId: string;
  inventories: InventoryTabProps["inventories"];
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-1 text-xs">
        This tab ships in a follow-up release. Phase B covers Inventory only.
      </p>
    </div>
  );
}

export function DeaDashboard(props: DeaDashboardProps) {
  const [tab, setTab] = useState("inventory");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="inventory">Inventory</TabsTrigger>
        <TabsTrigger value="orders">Orders</TabsTrigger>
        <TabsTrigger value="disposals">Disposals</TabsTrigger>
        <TabsTrigger value="theft-loss">Theft &amp; Loss</TabsTrigger>
      </TabsList>
      <TabsContent value="inventory" className="pt-4">
        <InventoryTab
          canManage={props.canManage}
          currentUserId={props.currentUserId}
          inventories={props.inventories}
        />
      </TabsContent>
      <TabsContent value="orders" className="pt-4">
        <ComingSoon label="Orders (Form 222 / CSOS receipts)" />
      </TabsContent>
      <TabsContent value="disposals" className="pt-4">
        <ComingSoon label="Disposals (Form 41 to reverse distributor)" />
      </TabsContent>
      <TabsContent value="theft-loss" className="pt-4">
        <ComingSoon label="Theft & Loss (Form 106)" />
      </TabsContent>
    </Tabs>
  );
}

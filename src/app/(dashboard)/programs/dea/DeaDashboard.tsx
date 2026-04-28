"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InventoryTab, type InventoryTabProps } from "./InventoryTab";
import { OrdersTab, type OrdersTabProps } from "./OrdersTab";
import { DisposalsTab, type DisposalsTabProps } from "./DisposalsTab";
import { TheftLossTab, type TheftLossTabProps } from "./TheftLossTab";

export interface DeaDashboardProps {
  canManage: boolean;
  inventories: InventoryTabProps["inventories"];
  orders: OrdersTabProps["orders"];
  disposals: DisposalsTabProps["disposals"];
  theftLossReports: TheftLossTabProps["reports"];
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
          inventories={props.inventories}
        />
      </TabsContent>
      <TabsContent value="orders" className="pt-4">
        <OrdersTab canManage={props.canManage} orders={props.orders} />
      </TabsContent>
      <TabsContent value="disposals" className="pt-4">
        <DisposalsTab
          canManage={props.canManage}
          disposals={props.disposals}
        />
      </TabsContent>
      <TabsContent value="theft-loss" className="pt-4">
        <TheftLossTab
          canManage={props.canManage}
          reports={props.theftLossReports}
        />
      </TabsContent>
    </Tabs>
  );
}

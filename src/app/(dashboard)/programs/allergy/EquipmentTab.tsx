"use client";

export interface EquipmentTabProps {
  canManage: boolean;
  checks: Array<{
    id: string;
    checkType: string;
    checkedAt: string;
    epiExpiryDate: string | null;
    allItemsPresent: boolean | null;
    temperatureC: number | null;
    inRange: boolean | null;
    notes: string | null;
  }>;
}

export function EquipmentTab(_props: EquipmentTabProps) {
  return <p className="text-sm text-muted-foreground">equipment — Task 9</p>;
}

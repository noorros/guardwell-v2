"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompetencyTab, type CompetencyTabProps } from "./CompetencyTab";
import { EquipmentTab, type EquipmentTabProps } from "./EquipmentTab";
import { DrillTab, type DrillTabProps } from "./DrillTab";

export interface AllergyDashboardProps {
  canManage: boolean;
  currentPracticeUserId: string;
  year: number;
  members: CompetencyTabProps["members"];
  competencies: CompetencyTabProps["competencies"];
  equipmentChecks: EquipmentTabProps["checks"];
  drills: DrillTabProps["drills"];
  legacyParticipants: DrillTabProps["legacyParticipants"];
}

export function AllergyDashboard(props: AllergyDashboardProps) {
  const [tab, setTab] = useState("compounders");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="compounders">Compounders</TabsTrigger>
        <TabsTrigger value="equipment">Equipment</TabsTrigger>
        <TabsTrigger value="drills">Drills</TabsTrigger>
      </TabsList>
      <TabsContent value="compounders" className="pt-4">
        <CompetencyTab
          canManage={props.canManage}
          year={props.year}
          members={props.members}
          competencies={props.competencies}
          currentPracticeUserId={props.currentPracticeUserId}
        />
      </TabsContent>
      <TabsContent value="equipment" className="pt-4">
        <EquipmentTab canManage={props.canManage} checks={props.equipmentChecks} />
      </TabsContent>
      <TabsContent value="drills" className="pt-4">
        <DrillTab
          canManage={props.canManage}
          members={props.members}
          drills={props.drills}
          legacyParticipants={props.legacyParticipants}
        />
      </TabsContent>
    </Tabs>
  );
}

import { useState } from "react";
import { ChecklistItem, type ChecklistStatus } from ".";

function Interactive({ initial }: { initial: ChecklistStatus }) {
  const [status, setStatus] = useState<ChecklistStatus>(initial);
  return (
    <ChecklistItem
      title="Designate Privacy Officer"
      description="45 CFR §164.530(a)(1)"
      status={status}
      onStatusChange={setStatus}
    />
  );
}

export const stories = {
  NotStarted: <Interactive initial="not_started" />,
  Compliant: <Interactive initial="compliant" />,
  Gap: <Interactive initial="gap" />,
  Disabled: (
    <ChecklistItem
      title="Read-only requirement"
      description="Viewer role cannot change status"
      status="compliant"
      onStatusChange={() => {}}
      disabled
    />
  ),
};

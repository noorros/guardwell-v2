// src/components/gw/DeadlineWarning/DeadlineWarning.stories.tsx
import { DeadlineWarning } from ".";

const today = new Date("2026-04-20T12:00:00Z");
function offset(days: number): Date {
  return new Date(today.getTime() + days * 86_400_000);
}

export const stories = {
  Overdue: (
    <DeadlineWarning
      label="DEA renewal"
      deadline={offset(-7)}
      now={today}
      description="Federal — submit via DEA Diversion Control Division"
    />
  ),
  Critical: (
    <DeadlineWarning label="Malpractice insurance renewal" deadline={offset(2)} now={today} />
  ),
  NeedsAction: (
    <DeadlineWarning
      label="State license renewal"
      deadline={offset(12)}
      now={today}
      description="Submit via AZ Medical Board portal"
    />
  ),
  Comfortable: <DeadlineWarning label="HIPAA training refresh" deadline={offset(25)} now={today} />,
  FarFuture: <DeadlineWarning label="Annual risk analysis" deadline={offset(90)} now={today} />,
  Today: <DeadlineWarning label="Staff attestation signing" deadline={offset(0)} now={today} />,
};

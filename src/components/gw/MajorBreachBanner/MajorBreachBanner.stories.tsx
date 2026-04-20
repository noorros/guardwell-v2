// src/components/gw/MajorBreachBanner/MajorBreachBanner.stories.tsx
import { MajorBreachBanner } from ".";

const NOW = new Date("2026-04-20T12:00:00Z");
function offset(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000);
}

export const stories = {
  JustOverThreshold: (
    <MajorBreachBanner affectedCount={500} reportingDeadline={offset(56)} now={NOW} />
  ),
  Thousands: (
    <MajorBreachBanner affectedCount={12_450} reportingDeadline={offset(30)} now={NOW} />
  ),
  UrgentDeadline: (
    <MajorBreachBanner affectedCount={2_100} reportingDeadline={offset(3)} now={NOW} />
  ),
  OverdueReport: (
    <MajorBreachBanner affectedCount={800} reportingDeadline={offset(-5)} now={NOW} />
  ),
  // Note: below threshold — renders nothing; gallery will show an "N/A" placeholder
  BelowThreshold: (
    <MajorBreachBanner affectedCount={250} reportingDeadline={offset(30)} now={NOW} />
  ),
};

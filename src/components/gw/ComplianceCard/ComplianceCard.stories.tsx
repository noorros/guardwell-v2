import { ComplianceCard } from ".";

export const stories = {
  Compliant: (
    <ComplianceCard
      title="HIPAA Privacy Rule"
      subtitle="45 CFR Part 164, Subpart E"
      score={95}
    />
  ),
  Good: <ComplianceCard title="HIPAA Security Rule" subtitle="45 CFR Part 164, Subpart C" score={78} />,
  NeedsWork: <ComplianceCard title="Breach Readiness" subtitle="45 CFR §164.400–414" score={62} />,
  AtRisk: <ComplianceCard title="OIG Compliance" subtitle="Safe harbor review" score={34} />,
  Linked: (
    <ComplianceCard
      title="HIPAA Privacy"
      subtitle="Tap to open module"
      score={82}
      href="#"
    />
  ),
  WithFooter: (
    <ComplianceCard
      title="OSHA BBP"
      subtitle="29 CFR §1910.1030"
      score={65}
      footer={<span className="text-xs text-muted-foreground">3 gaps</span>}
    />
  ),
};

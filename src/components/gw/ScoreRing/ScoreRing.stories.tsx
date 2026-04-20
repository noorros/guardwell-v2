import { ScoreRing } from ".";

export const stories = {
  Compliant: <ScoreRing score={95} label="HIPAA Privacy" />,
  Good: <ScoreRing score={78} label="HIPAA Security" />,
  NeedsWork: <ScoreRing score={62} label="Breach Readiness" />,
  AtRisk: <ScoreRing score={34} label="OIG Compliance" />,
  Zero: <ScoreRing score={0} label="Not Started" />,
  Perfect: <ScoreRing score={100} label="All Done" />,
  LargeNoLabel: <ScoreRing score={88} size={160} strokeWidth={14} />,
};
